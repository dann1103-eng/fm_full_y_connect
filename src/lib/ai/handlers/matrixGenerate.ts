import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadBrandProfile } from '@/lib/data/brand'
import { loadMatrixEditorData, sharedTypesFor, type MatrixEditorData } from '@/lib/data/matrices'
import { hasUsableBrandProfile } from '@/lib/domain/brand'
import { sanitizeTopics } from '@/lib/domain/matrix'
import {
  assignDeadlines, missingByType, pendingChildWork, sanitizeGeneratedPlan,
  type GeneratedPiece, type PlanCapacity,
} from '@/lib/domain/matrix-ai'
import { MATRIX_PARENT_PARAMS, matrixModel, requireAnthropicApiKey } from '@/lib/ai/matrix/model'
import { accumulateJobCost } from '@/lib/ai/matrix/cost'
import {
  MATRIX_PLAN_TOOL_NAME, buildBrandSystemBlock, buildPlanPrompt, forceTool, matrixPlanTool, readToolInput,
} from '@/lib/ai/matrix/prompts'
import { triggerJobRunner } from '@/lib/ai/trigger'
import type { AiHandler, AiHandlerCtx } from '@/lib/ai/types'
import type { ContentMatrixItem, ContentType, Database, MatrixTopic } from '@/types/db'

type Admin = ReturnType<typeof createAdminClient>
type ItemInsert = Database['public']['Tables']['content_matrix_items']['Insert']

/** Prioridad de los dos jobs de matriz: por debajo del recordatorio de factura (7) a propósito. */
export const MATRIX_JOB_PRIORITY = 8

/** Cuántas piezas atiende cada invocación del runner disparada por el padre, y cuántas se disparan. */
const CHILDREN_PER_RUNNER = 3
const MAX_RUNNER_FANOUT = 5

interface GenerateInput { matrixId?: string }

// `type` y no `interface`: solo un alias de tipo objeto es asignable a `Record<string, unknown>`
// (el `result_json` del job), una interfaz no lo es.
type GenerateResult = {
  itemsCreated: number
  childJobs: number
  topics: number
  /** `sin_plan_valido` y compañía: la ruta de progreso lo lee para que la franja no muestre un éxito mudo. */
  reason?: string
  skipped?: string
}

/**
 * Handler padre `matrix_generate` (bloque 3): planifica la matriz del mes, crea las filas de las
 * piezas —vacías de texto— y encola un hijo `matrix_item_write` por pieza.
 *
 * Diseño: `docs/superpowers/specs/2026-09-17-creador-de-matrices-bloque-3-design.md` (Parte 3).
 *
 * **Su trabajo son dos invariantes, no "correr una vez"** (paso 2): (a) que existan piezas hasta
 * cubrir el cupo faltante y (b) que toda pieza sin redactar tenga un hijo. Eso es lo que lo hace
 * inofensivo frente al watchdog de 0124, que lo rescata a los cinco minutos de quedar colgado.
 */
export const matrixGenerateHandler: AiHandler<GenerateInput, GenerateResult> = async (ctx) => {
  // Los ids se leen de `input_json`, no de `ctx.job`: `AiJobRow` de `src/lib/ai/types.ts` es una
  // interfaz escrita a mano que no tiene las columnas nuevas (es lo que hace `invoiceDueReminder`).
  const { matrixId } = ctx.job.input_json as GenerateInput
  if (!matrixId) throw new Error('matrix_generate: matrixId requerido')

  // Cliente admin propio y TIPADO: `ctx.supabase` es un `SupabaseClient` genérico y no se escribe con él.
  const admin = createAdminClient()

  // ── Paso 1: estado actual ────────────────────────────────────────────────
  const data = await loadMatrixEditorData(admin, matrixId)
  if (!data) return skip(ctx, { reason: 'matriz_no_encontrada' })
  // Generar dentro de una matriz aprobada es peligroso: el barrido del bloque 2 convertiría las piezas
  // nuevas en requerimientos reales sin que nadie las hubiera revisado.
  if (data.matrix.status !== 'draft') return skip(ctx, { reason: 'matriz_no_borrador', status: data.matrix.status })

  const profile = await loadBrandProfile(admin, data.matrix.client_id)
  if (!profile || !hasUsableBrandProfile(profile)) return skip(ctx, { reason: 'sin_perfil_de_marca' })

  // ── Paso 2: las dos invariantes ──────────────────────────────────────────
  const capacity = missingByType(data.limits, data.usage)
  const orphans = pendingChildWork(data.items, await readChildJobs(admin, matrixId))

  if (capacity.total === 0) {
    // (a) está cubierto. Si (b) también, no hay nada que hacer; si no, se encolan los hijos que faltan
    // y se termina **sin llamar al modelo**: es el caso de morir entre el insert y el encolado.
    if (orphans.length === 0) return skip(ctx, { reason: 'cupo_cubierto' })
    const enqueued = await enqueueChildren(ctx, admin, data, withDeadlines(data.items, orphans))
    return {
      itemsCreated: 0,
      childJobs: enqueued,
      topics: (data.matrix.topics_json ?? []).length,
      reason: 'hijos_reencolados',
    }
  }

  // ── Paso 3: una llamada al modelo ────────────────────────────────────────
  const loadedTopics = data.matrix.topics_json ?? []
  const askForTopics = loadedTopics.length === 0
  const allowedTypes = data.usage.activeTypes.filter((t) => (capacity.missing[t] ?? 0) > 0)
  if (allowedTypes.length === 0) return skip(ctx, { reason: 'sin_tipos_activos' })

  await ctx.logEvent('progress', { step: 'claude_call', pieces: capacity.total })
  const anthropic = new Anthropic({ apiKey: requireAnthropicApiKey() })
  const response = await anthropic.messages.create({
    model: matrixModel(),
    max_tokens: MATRIX_PARENT_PARAMS.max_tokens,
    temperature: MATRIX_PARENT_PARAMS.temperature,
    system: [{
      type: 'text',
      text: buildBrandSystemBlock({ client: data.client, profile, matrix: data.matrix, period: data.period }),
      cache_control: { type: 'ephemeral' },
    }],
    tools: [matrixPlanTool({ allowedTypes, askForTopics })],
    tool_choice: forceTool(MATRIX_PLAN_TOOL_NAME),
    messages: [{
      role: 'user',
      content: buildPlanPrompt({
        capacity,
        allowedTypes,
        topics: loadedTopics,
        existingTitles: data.items.map((i) => i.title).filter((t) => t.trim().length > 0),
      }),
    }],
  })
  await accumulateJobCost(admin, ctx.job.id, response.usage)

  const output = readToolInput(response.content, MATRIX_PLAN_TOOL_NAME) as
    | { topics?: unknown; pieces?: unknown }
    | null

  // ── Paso 5: los temas, con update condicional ────────────────────────────
  const { topics: finalTopics, written: topicsWritten } = await resolveTopics(admin, matrixId, {
    askForTopics,
    proposed: output?.topics,
  })

  // ── Paso 4: el ÚNICO filtro entre el modelo y la base ────────────────────
  const plan = sanitizeGeneratedPlan(output?.pieces, {
    activeTypes: data.usage.activeTypes,
    missing: capacity.missing,
    poolRemaining: capacity.poolRemaining,
    topics: finalTopics,
  })
  if (plan.length === 0) {
    await ctx.logEvent('sin_plan_valido', {
      pieces: Array.isArray(output?.pieces) ? (output.pieces as unknown[]).length : 0,
    })
    return {
      itemsCreated: 0,
      childJobs: 0,
      topics: topicsWritten ? finalTopics.length : 0,
      reason: 'sin_plan_valido',
    }
  }

  // ── Paso 6: recalcular el faltante y recortar ────────────────────────────
  // Entre la foto del cupo y el insert hubo una llamada al modelo, y en esa ventana el barrido del
  // bloque 2, un registro manual o la aprobación de una solicitud del portal pudieron consumir cupo.
  // Los chips siguen siendo la verdad, así que se relee exactamente la misma fuente.
  const fresh = await loadMatrixEditorData(admin, matrixId)
  if (!fresh) return skip(ctx, { reason: 'matriz_no_encontrada' })
  if (fresh.matrix.status !== 'draft') return skip(ctx, { reason: 'matriz_no_borrador', status: fresh.matrix.status })

  const capacity2 = missingByType(fresh.limits, fresh.usage)
  const trimmed = trimToCapacity(plan, capacity2)
  const freshOrphans = pendingChildWork(fresh.items, await readChildJobs(admin, matrixId))

  if (trimmed.length === 0) {
    const enqueued = await enqueueChildren(ctx, admin, fresh, withDeadlines(fresh.items, freshOrphans))
    return {
      itemsCreated: 0,
      childJobs: enqueued,
      topics: topicsWritten ? finalTopics.length : 0,
      reason: 'cupo_cubierto',
    }
  }

  const planned = assignDeadlines(trimmed, {
    existingItems: fresh.items,
    distribution: fresh.distribution,
    periodStart: fresh.period.periodStart,
    periodEnd: fresh.period.periodEnd,
    maxWeek: fresh.maxWeek,
    sharedTypes: sharedTypesFor(fresh.limits),
    today: fresh.today,
  })

  // `assigned_to` prerrellenado con los responsables por defecto, igual que `addItem`: sin esto toda
  // pieza generada falla `validateForApproval` con `sin_responsable` y la matriz no se podría aprobar.
  const defaultAssignees = fresh.assignableUsers.filter((u) => u.default_assignee).map((u) => u.id)
  const rows: ItemInsert[] = planned.map((p) => ({
    matrix_id: matrixId,
    content_type: p.content_type,
    title: p.title,
    // El tema lo fija el padre a partir del índice; el hijo nunca lo toca.
    topic: p.topicIndex !== null ? (finalTopics[p.topicIndex]?.name ?? null) : null,
    objective: p.objective,
    deadline: p.deadline,
    needs_production: p.needs_production,
    estimated_time_minutes: p.estimated_time_minutes,
    assigned_to: defaultAssignees.length > 0 ? defaultAssignees : null,
  }))

  const { data: inserted, error: insertError } = await admin
    .from('content_matrix_items')
    .insert(rows)
    .select('id, deadline')
  if (insertError) throw new Error(`matrix_generate: no se pudieron crear las piezas: ${insertError.message}`)
  const created = (inserted ?? []) as Pick<ContentMatrixItem, 'id' | 'deadline'>[]
  await ctx.logEvent('progress', { step: 'piezas_creadas', count: created.length })

  // ── Paso 7: un hijo por pieza, de la más urgente a la menos ──────────────
  const toWrite = [...withDeadlines(fresh.items, freshOrphans), ...created].sort(byDeadline)
  const enqueued = await enqueueChildren(ctx, admin, fresh, toWrite)

  return {
    itemsCreated: created.length,
    childJobs: enqueued,
    topics: topicsWritten ? finalTopics.length : 0,
  }
}

// ── Piezas auxiliares ───────────────────────────────────────────────────────

async function skip(ctx: AiHandlerCtx, payload: { reason: string; status?: string }): Promise<GenerateResult> {
  await ctx.logEvent('skipped', payload)
  return { itemsCreated: 0, childJobs: 0, topics: 0, skipped: payload.reason }
}

/**
 * Los `matrix_item_write` de la matriz, **sin filtrar por estado**: un hijo `failed` no se reintenta
 * solo (la salida es el botón "Regenerar"), así que cuenta igual para la invariante (b).
 */
async function readChildJobs(admin: Admin, matrixId: string) {
  const { data, error } = await admin
    .from('ai_jobs')
    .select('content_matrix_item_id, status')
    .eq('job_type', 'matrix_item_write')
    .eq('content_matrix_id', matrixId)
  if (error) throw new Error(`matrix_generate: no se pudieron leer los hijos: ${error.message}`)
  return data ?? []
}

interface WriteTarget { id: string; deadline: string }

function byDeadline(a: WriteTarget, b: WriteTarget): number {
  return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0
}

/** Convierte una lista de ids en `{ id, deadline }` ordenada, usando las piezas ya cargadas. */
function withDeadlines(items: readonly ContentMatrixItem[], ids: readonly string[]): WriteTarget[] {
  const deadlineById = new Map(items.map((i) => [i.id, i.deadline]))
  return ids.map((id) => ({ id, deadline: deadlineById.get(id) ?? '' })).sort(byDeadline)
}

/**
 * Encola un hijo por pieza, **fila por fila tragando el 23505 por código**: en un insert por lote un
 * solo conflicto abortaría todo el batch. Cada hijo lleva `content_matrix_item_id` sí o sí — sin él el
 * índice único parcial no aplica (en btree los nulos no colisionan) y se pierden a la vez el candado
 * del doble clic y la idempotencia del re-encolado.
 */
async function enqueueChildren(
  ctx: AiHandlerCtx,
  admin: Admin,
  data: MatrixEditorData,
  targets: readonly WriteTarget[],
): Promise<number> {
  let enqueued = 0
  for (const t of targets) {
    const { error } = await admin.from('ai_jobs').insert({
      job_type: 'matrix_item_write',
      status: 'pending',
      priority: MATRIX_JOB_PRIORITY,
      client_id: data.matrix.client_id,
      triggered_by: ctx.job.triggered_by,
      parent_job_id: ctx.job.id,
      content_matrix_id: data.matrix.id,
      content_matrix_item_id: t.id,
      input_json: { itemId: t.id },
      scheduled_for: new Date().toISOString(),
    })
    if (error) {
      // 23505 = esa pieza ya tiene un hijo vivo. No es un error: es justo lo que hace idempotente el
      // re-encolado del paso 2 y lo que ataja el doble clic.
      if (error.code !== '23505') console.error('[matrix_generate] encolar hijo', t.id, error.message)
      continue
    }
    enqueued++
  }

  if (enqueued > 0) {
    await ctx.logEvent('progress', { step: 'hijos_encolados', count: enqueued })
    // Fan-out honesto gracias al presupuesto de tiempo del runner: `for update skip locked` reparte
    // los trabajos entre las invocaciones sin que dos se pisen.
    const runners = Math.min(MAX_RUNNER_FANOUT, Math.ceil(enqueued / CHILDREN_PER_RUNNER))
    for (let i = 0; i < runners; i++) void triggerJobRunner({ max: CHILDREN_PER_RUNNER, waitMs: 0 })
  }
  return enqueued
}

/**
 * Los temas finales de la matriz. Si se los pedimos al modelo, se releen **justo antes de escribir** y
 * no se escribe nada si el usuario agregó los suyos mientras el modelo pensaba (no hay idiom de
 * PostgREST para "solo si sigue siendo `[]`" que el repo use; el índice de un único padre activo hace
 * la ventana pequeña).
 */
async function resolveTopics(
  admin: Admin,
  matrixId: string,
  opts: { askForTopics: boolean; proposed: unknown },
): Promise<{ topics: MatrixTopic[]; written: boolean }> {
  const { data, error } = await admin.from('content_matrices').select('topics_json').eq('id', matrixId).maybeSingle()
  if (error) throw new Error(`matrix_generate: no se pudieron releer los temas: ${error.message}`)
  const current = (data?.topics_json ?? []) as MatrixTopic[]

  if (!opts.askForTopics) return { topics: current, written: false }

  const proposed = sanitizeTopics(opts.proposed as MatrixTopic[])
  if (current.length > 0 || proposed.length === 0) {
    // Perdimos la carrera (o el modelo no propuso temas): los índices que devolvió apuntan a una lista
    // que nunca se escribió, así que no se usan y las piezas nacen sin tema, que es válido.
    return { topics: [], written: false }
  }

  const { error: updateError } = await admin
    .from('content_matrices')
    .update({ topics_json: proposed })
    .eq('id', matrixId)
  if (updateError) {
    console.error('[matrix_generate] no se pudieron guardar los temas', updateError.message)
    return { topics: [], written: false }
  }
  return { topics: proposed, written: true }
}

/**
 * Recorta el plan al faltante recalculado. Bajo pool el tope por tipo vale el pool entero para los
 * cuatro tippables, así que el corte del TOTAL no es opcional.
 */
function trimToCapacity(plan: readonly GeneratedPiece[], capacity: PlanCapacity): GeneratedPiece[] {
  const taken: Partial<Record<ContentType, number>> = {}
  const out: GeneratedPiece[] = []
  for (const p of plan) {
    if (capacity.poolRemaining !== null && out.length >= capacity.poolRemaining) break
    const cap = capacity.missing[p.content_type] ?? 0
    if ((taken[p.content_type] ?? 0) >= cap) continue
    taken[p.content_type] = (taken[p.content_type] ?? 0) + 1
    out.push(p)
  }
  return out
}
