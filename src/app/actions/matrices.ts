'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from './impersonation'
import { canManageMatrices } from '@/lib/domain/permissions'
import { effectiveLimits, applyContentLimitsWithOverride } from '@/lib/domain/plans'
import { computeTotals } from '@/lib/domain/requirement'
import { insertInitialPhaseLog } from '@/lib/domain/pipeline'
import { today, addDaysString } from '@/lib/domain/dates'
import {
  canTransition, isIsoDate, matrixTitleFor, pickCycleForPeriod, sanitizeTopics, validateForApproval, validateItemPatch,
  proposeDeadline, shiftDeadline, MATRIX_CONTENT_TYPES,
  type ActionErr, type ActionResult, type LinkResult, type ApprovalProblem, type ItemPatch,
} from '@/lib/domain/matrix'
import { loadMatrixEditorData, loadTargetPeriodsForClient, sharedTypesFor, type TargetPeriodsForClient } from '@/lib/data/matrices'
import type { ContentMatrix, ContentMatrixItem, ContentType, Database, MatrixStatus, MatrixTopic, Requirement } from '@/types/db'

// ── Helpers ──────────────────────────────────────────────────────────────────

type Ctx = { supabase: Awaited<ReturnType<typeof createClient>>; userId: string }
type MatrixUpdate = Database['public']['Tables']['content_matrices']['Update']

const INVALID_DATA = 'Datos inválidos.'
const LOAD_ERROR = 'No se pudieron cargar los datos. Intenta de nuevo.'
const INVALID_PERIOD = 'Período inválido para este cliente.'

const TITLE_MAX = 200
const NOTES_MAX = 5000

/** Campos de texto libre de una pieza: tope de longitud y mensaje (etiquetas del editor). */
const ITEM_TEXT_FIELDS = [
  { key: 'copy', max: 5000, tooLong: 'El copy es demasiado largo.' },
  { key: 'script', max: 10000, tooLong: 'El guión es demasiado largo.' },
  { key: 'visual_style', max: 2000, tooLong: 'El estilo visual es demasiado largo.' },
  { key: 'hashtags', max: 2000, tooLong: 'Los hashtags son demasiado largos.' },
  { key: 'cta', max: 2000, tooLong: 'El llamado a la acción es demasiado largo.' },
] as const

/**
 * Autenticación + rol admin/supervisor. Las acciones de mutación bloquean además el modo
 * espectador; las de solo lectura (`readOnly`) no, igual que el resto de server actions.
 */
async function requireManager(opts: { readOnly?: boolean } = {}): Promise<Ctx | { error: string }> {
  if (!opts.readOnly) await assertNotImpersonating()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!canManageMatrices(data?.role)) return { error: 'Sin permisos' }
  return { supabase, userId: user.id }
}

/**
 * Revalida lista, editor y perfil del cliente. En esta versión de Next, llamar a `revalidatePath`
 * dentro de una server action hace que la respuesta re-renderice la página actual sea cual sea el
 * path. Por eso los guardados por campo del editor (updateItem, y updateMatrix salvo el título, que
 * se ve en el TopNav) NO la llaman: el editor aplica localmente la fila devuelta.
 */
function revalidateMatrix(clientId: string, matrixId?: string) {
  revalidatePath('/matrices')
  if (matrixId) revalidatePath(`/matrices/${matrixId}`)
  revalidatePath(`/clients/${clientId}`)
}

function dbError(error: { code?: string; message: string } | null, fallback: string): string {
  if (!error) return fallback
  if (error.code === '23505') return 'Ya existe una matriz para ese período.'
  return error.message || fallback
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/**
 * Texto opcional venido del navegador: acepta `undefined`/`null`/string, recorta y devuelve `null` si
 * queda vacío. Falla si no es string o si supera `max` caracteres.
 */
function textOrNull(v: unknown, max: number): { ok: true; value: string | null } | { ok: false; tooLong: boolean } {
  if (v === undefined || v === null) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, tooLong: false }
  const s = v.trim()
  if (s.length > max) return { ok: false, tooLong: true }
  return { ok: true, value: s || null }
}

/** `textOrNull` con el error ya en forma de ActionErr (`tooLongMsg` en español). */
function textField(v: unknown, max: number, tooLongMsg: string): { ok: true; value: string | null } | ActionErr {
  const r = textOrNull(v, max)
  if (r.ok) return r
  return { ok: false, error: r.tooLong ? tooLongMsg : INVALID_DATA }
}

/** Los loaders lanzan ante errores de consulta; dentro de una acción se devuelven como `{ ok: false }`. */
async function safeLoad<T>(label: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | ActionErr> {
  try {
    return { ok: true, value: await fn() }
  } catch (e) {
    console.error(`[matrices] ${label}`, e)
    return { ok: false, error: LOAD_ERROR }
  }
}

/**
 * El período `{ periodStart, periodEnd }` que manda el navegador debe coincidir exactamente con uno
 * de los períodos objetivo del cliente (ciclo vigente + 3 siguientes).
 */
async function validateTargetPeriod(ctx: Ctx, clientId: string, period: { periodStart: string; periodEnd: string }): Promise<ActionErr | null> {
  const r = await safeLoad('validateTargetPeriod', () => loadTargetPeriodsForClient(ctx.supabase, clientId))
  if (!r.ok) return r
  if (!r.value) return { ok: false, error: 'Cliente no encontrado.' }
  const match = r.value.periods.some((p) => p.periodStart === period.periodStart && p.periodEnd === period.periodEnd)
  return match ? null : { ok: false, error: INVALID_PERIOD }
}

/** billing_cycle_id de una matriz nueva: ciclo current o scheduled con ese period_start (current gana). */
async function resolveCycleIdForPeriod(ctx: Ctx, clientId: string, periodStart: string): Promise<{ ok: true; id: string | null } | ActionErr> {
  const { data, error } = await ctx.supabase.from('billing_cycles').select('id, status, created_at')
    .eq('client_id', clientId).eq('period_start', periodStart).in('status', ['current', 'scheduled'])
  if (error) return { ok: false, error: dbError(error, 'No se pudo leer el ciclo del período.') }
  return { ok: true, id: pickCycleForPeriod(data ?? [])?.id ?? null }
}

/**
 * Borra (service role) un requerimiento recién creado por `linkMatrixRequirement` que no se pudo
 * vincular, para no dejar un huérfano que consuma cupo. Nunca lanza.
 */
async function discardUnlinkedRequirement(reqId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    // Orden obligatorio del proyecto: requirement_phase_logs → requirements
    const { error: e1 } = await admin.from('requirement_phase_logs').delete().eq('requirement_id', reqId)
    if (e1) { console.error('[matrices] no se pudieron borrar los logs del requerimiento sin vincular', reqId, e1.message); return }
    const { error: e2 } = await admin.from('requirements').delete().eq('id', reqId)
    if (e2) console.error('[matrices] no se pudo borrar el requerimiento sin vincular', reqId, e2.message)
  } catch (e) {
    console.error('[matrices] error limpiando el requerimiento sin vincular', reqId, e)
  }
}

/**
 * Registra el requerimiento de tipo matriz_contenido en el ciclo vigente y lo vincula.
 * Usa el cliente AUTENTICADO para que el trigger de pago aplique como a un registro manual.
 * (`requirements.requested_via` no está en el tipo Insert de src/types/db.ts, así que no se setea.)
 */
async function linkMatrixRequirement(ctx: Ctx, matrixId: string): Promise<LinkResult> {
  const { supabase, userId } = ctx
  const { data: m } = await supabase.from('content_matrices')
    .select('id, client_id, title, period_start, matrix_requirement_id').eq('id', matrixId).single()
  if (!m) return { ok: false, error: 'Matriz no encontrada.' }
  if (m.matrix_requirement_id) return { ok: true, requirementId: m.matrix_requirement_id }

  const QUOTA_ERROR = 'No se pudo verificar el cupo de matriz. Intenta de nuevo.'
  const { data: cycleRows, error: cycleError } = await supabase.from('billing_cycles').select('*')
    .eq('client_id', m.client_id).eq('status', 'current').order('created_at', { ascending: false }).limit(1)
  if (cycleError) return { ok: false, error: QUOTA_ERROR }
  const cycle = cycleRows?.[0]
  if (!cycle) return { ok: false, error: 'El cliente no tiene ciclo vigente.' }

  const { data: reqs, error: reqsError } = await supabase.from('requirements').select('*')
    .eq('billing_cycle_id', cycle.id).eq('approval_status', 'approved')
  if (reqsError) return { ok: false, error: QUOTA_ERROR }
  const totals = computeTotals((reqs ?? []) as Requirement[])
  const limits = applyContentLimitsWithOverride(
    effectiveLimits(cycle.limits_snapshot_json, cycle.rollover_from_previous_json),
    (cycle.content_limits_override_json ?? null) as Record<string, number> | null,
  )
  if (totals.matriz_contenido >= limits.matriz_contenido) {
    return { ok: false, error: 'El plan no tiene cupo de matriz en el ciclo vigente.' }
  }

  const t = today()
  const deadline = m.period_start > t ? m.period_start : addDaysString(t, 3)
  const { data: req, error } = await supabase.from('requirements').insert({
    billing_cycle_id: cycle.id,
    content_type: 'matriz_contenido',
    title: m.title || 'Matriz de contenido',
    registered_by_user_id: userId,
    priority: 'media',
    over_limit: false,
    approval_status: 'approved',
    includes_story: false,
    deadline,
  }).select('id').single()
  if (error || !req) return { ok: false, error: error?.message ?? 'No se pudo registrar el requerimiento de matriz.' }

  await insertInitialPhaseLog(supabase, { requirementId: req.id, movedBy: userId })

  // Solo vincula si nadie lo hizo entretanto (doble clic / reintentos concurrentes).
  const { data: linkedRows, error: linkError } = await supabase.from('content_matrices')
    .update({ matrix_requirement_id: req.id })
    .eq('id', matrixId).is('matrix_requirement_id', null)
    .select('id')
  if (linkError || !linkedRows?.length) {
    await discardUnlinkedRequirement(req.id)
    if (linkError) return { ok: false, error: linkError.message || 'No se pudo vincular el requerimiento de matriz.' }
    const { data: again } = await supabase.from('content_matrices').select('matrix_requirement_id').eq('id', matrixId).maybeSingle()
    if (again?.matrix_requirement_id) return { ok: true, requirementId: again.matrix_requirement_id }
    return { ok: false, error: 'No se pudo vincular el requerimiento de matriz.' }
  }
  return { ok: true, requirementId: req.id }
}

// ── Períodos (para el diálogo) ───────────────────────────────────────────────

export async function listTargetPeriods(clientId: string): Promise<ActionResult<TargetPeriodsForClient>> {
  const ctx = await requireManager({ readOnly: true })
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const r = await safeLoad('listTargetPeriods', () => loadTargetPeriodsForClient(ctx.supabase, clientId))
  if (!r.ok) return r
  if (!r.value) return { ok: false, error: 'Cliente no encontrado.' }
  return { ok: true, ...r.value }
}

// ── Matriz ───────────────────────────────────────────────────────────────────

export async function createMatrix(input: {
  clientId: string
  periodStart: string
  periodEnd: string
  title: string
  topics: MatrixTopic[]
  notes: string | null
}): Promise<ActionResult<{ id: string; link: LinkResult }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase, userId } = ctx

  if (!isPlainObject(input) || typeof input.clientId !== 'string') return { ok: false, error: INVALID_DATA }
  if (!isIsoDate(input.periodStart) || !isIsoDate(input.periodEnd)) return { ok: false, error: INVALID_PERIOD }
  const title = textField(input.title, TITLE_MAX, 'El título es demasiado largo.')
  if (!title.ok) return title
  const notes = textField(input.notes, NOTES_MAX, 'Las notas son demasiado largas.')
  if (!notes.ok) return notes

  const periodError = await validateTargetPeriod(ctx, input.clientId, input)
  if (periodError) return periodError

  const { data: existing } = await supabase.from('content_matrices').select('id')
    .eq('client_id', input.clientId).eq('period_start', input.periodStart).maybeSingle()
  if (existing) return { ok: false, error: 'Ya existe una matriz para ese período.' }

  const cycle = await resolveCycleIdForPeriod(ctx, input.clientId, input.periodStart)
  if (!cycle.ok) return cycle

  const { data: created, error } = await supabase.from('content_matrices').insert({
    client_id: input.clientId,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    billing_cycle_id: cycle.id,
    title: title.value ?? matrixTitleFor(input.periodStart, input.periodEnd),
    topics_json: sanitizeTopics(input.topics),
    notes: notes.value,
    created_by: userId,
  }).select('id').single()
  if (error || !created) return { ok: false, error: dbError(error, 'No se pudo crear la matriz.') }

  const link = await linkMatrixRequirement(ctx, created.id)
  revalidateMatrix(input.clientId, created.id)
  return { ok: true, id: created.id, link }
}

export async function retryMatrixRequirementLink(matrixId: string): Promise<ActionResult<{ link: LinkResult }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const link = await linkMatrixRequirement(ctx, matrixId)
  const { data: m } = await ctx.supabase.from('content_matrices').select('client_id').eq('id', matrixId).single()
  if (m) revalidateMatrix(m.client_id, matrixId)
  return { ok: true, link }
}

export async function updateMatrix(matrixId: string, patch: {
  title?: string
  topics?: MatrixTopic[]
  notes?: string | null
  lead_days?: number
}): Promise<ActionResult<{ matrix: ContentMatrix }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase } = ctx

  if (!isPlainObject(patch)) return { ok: false, error: INVALID_DATA }
  const title = patch.title !== undefined ? textField(patch.title, TITLE_MAX, 'El título es demasiado largo.') : null
  if (title && !title.ok) return title
  const notes = patch.notes !== undefined ? textField(patch.notes, NOTES_MAX, 'Las notas son demasiado largas.') : null
  if (notes && !notes.ok) return notes
  if (patch.lead_days !== undefined && (!Number.isInteger(patch.lead_days) || patch.lead_days < 0 || patch.lead_days > 30)) {
    return { ok: false, error: 'La anticipación debe estar entre 0 y 30 días.' }
  }
  // Un valor que no es array se sanitizaría a [] y borraría todos los temas.
  if (patch.topics !== undefined && !Array.isArray(patch.topics)) return { ok: false, error: INVALID_DATA }

  const { data: current, error: readError } = await supabase.from('content_matrices').select('*').eq('id', matrixId).maybeSingle()
  if (readError) return { ok: false, error: dbError(readError, 'No se pudo leer la matriz.') }
  if (!current) return { ok: false, error: 'Matriz no encontrada.' }
  if (current.status === 'closed') return { ok: false, error: 'La matriz está cerrada.' }

  const update: MatrixUpdate = {}
  if (title) update.title = title.value ?? matrixTitleFor(current.period_start, current.period_end)
  if (notes) update.notes = notes.value
  if (patch.lead_days !== undefined) update.lead_days = patch.lead_days
  if (patch.topics !== undefined) {
    const topics = sanitizeTopics(patch.topics)
    update.topics_json = topics
    const kept = new Set(topics.map((t) => t.name))
    const removed = (current.topics_json as MatrixTopic[]).map((t) => t.name).filter((n) => !kept.has(n))
    if (removed.length > 0) {
      // Primero se sueltan las piezas de los temas quitados: si falla, no se cambió nada.
      const { error: topicError } = await supabase.from('content_matrix_items')
        .update({ topic: null }).eq('matrix_id', matrixId).in('topic', removed)
      if (topicError) return { ok: false, error: dbError(topicError, 'No se pudieron actualizar los temas de las piezas.') }
    }
  }

  const { data: matrix, error } = await supabase.from('content_matrices').update(update).eq('id', matrixId).select('*').single()
  if (error || !matrix) return { ok: false, error: dbError(error, 'No se pudo guardar.') }
  // Guardado por campo: solo el título se ve fuera del editor (ver revalidateMatrix).
  if (patch.title !== undefined) revalidateMatrix(matrix.client_id, matrixId)
  return { ok: true, matrix: matrix as ContentMatrix }
}

export async function setMatrixStatus(
  matrixId: string,
  to: MatrixStatus,
): Promise<ActionResult<{ matrix: ContentMatrix }> | (ActionErr & { problems?: ApprovalProblem[]; empty?: boolean })> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase, userId } = ctx

  const [matrixRes, itemsRes] = await Promise.all([
    supabase.from('content_matrices').select('*').eq('id', matrixId).maybeSingle(),
    supabase.from('content_matrix_items').select('id, title, deadline, status').eq('matrix_id', matrixId),
  ])
  if (matrixRes.error) return { ok: false, error: dbError(matrixRes.error, 'No se pudo leer la matriz.') }
  if (itemsRes.error) return { ok: false, error: dbError(itemsRes.error, 'No se pudieron leer las piezas de la matriz.') }
  const current = matrixRes.data
  if (!current) return { ok: false, error: 'Matriz no encontrada.' }
  const list = (itemsRes.data ?? []) as Pick<ContentMatrixItem, 'id' | 'title' | 'deadline' | 'status'>[]
  const hasConvertedItems = list.some((i) => i.status === 'converted')

  if (!canTransition(current.status, to, { hasConvertedItems })) {
    return { ok: false, error: 'Ese cambio de estado no está permitido.' }
  }
  if (to === 'approved') {
    const v = validateForApproval(list, { periodStart: current.period_start, periodEnd: current.period_end })
    if (v.empty) return { ok: false, error: 'Agrega al menos una pieza antes de aprobar.', empty: true }
    if (!v.ok) return { ok: false, error: 'Hay piezas incompletas.', problems: v.problems }
  }

  const update: MatrixUpdate = { status: to }
  if (to === 'approved') { update.approved_by = userId; update.approved_at = new Date().toISOString() }
  if (to === 'draft') { update.approved_by = null; update.approved_at = null }
  if (to === 'closed') update.closed_at = new Date().toISOString()

  // Condicional al estado leído: si otra sesión lo cambió entretanto, no se pisa.
  const { data: rows, error } = await supabase.from('content_matrices').update(update)
    .eq('id', matrixId).eq('status', current.status).select('*')
  if (error) return { ok: false, error: dbError(error, 'No se pudo cambiar el estado.') }
  const matrix = rows?.[0]
  if (!matrix) return { ok: false, error: 'La matriz cambió; recarga la página.' }
  revalidateMatrix(matrix.client_id, matrixId)
  return { ok: true, matrix: matrix as ContentMatrix }
}

/**
 * Borra (service role) el requerimiento de matriz de una matriz ya eliminada, solo si no tiene nada
 * con significado: debe seguir siendo matriz_contenido, en fase `pendiente`, sin pago con crédito y sin
 * filas en time_entries, requirement_messages, review_assets, requirement_cambio_logs ni ai_jobs.
 * Todas esas tablas referencian `requirements` con ON DELETE CASCADE, así que borrarlo con datos los
 * perdería en silencio. (requirement_mentions y review_comment_mentions también tienen FK propia, pero
 * no existen sin un mensaje o un asset de revisión.) Nunca lanza ni falla la acción: ante cualquier duda
 * conserva el requerimiento y lo registra en consola.
 */
async function discardMatrixRequirementIfUnused(reqId: string): Promise<void> {
  try {
    const admin = createAdminClient()
    const [req, timeEntries, messages, reviewAssets, cambioLogs, aiJobs] = await Promise.all([
      admin.from('requirements').select('id, content_type, phase, paid_from_credit_id').eq('id', reqId).maybeSingle(),
      admin.from('time_entries').select('id', { count: 'exact', head: true }).eq('requirement_id', reqId),
      admin.from('requirement_messages').select('id', { count: 'exact', head: true }).eq('requirement_id', reqId),
      admin.from('review_assets').select('id', { count: 'exact', head: true }).eq('requirement_id', reqId),
      admin.from('requirement_cambio_logs').select('id', { count: 'exact', head: true }).eq('requirement_id', reqId),
      admin.from('ai_jobs').select('id', { count: 'exact', head: true }).eq('requirement_id', reqId),
    ])
    const checks = [timeEntries, messages, reviewAssets, cambioLogs, aiJobs]
    const checkError = req.error ?? checks.find((c) => c.error)?.error
    if (checkError) {
      console.error('[deleteMatrix] no se pudo verificar el requerimiento vinculado; se conserva', reqId, checkError.message)
      return
    }
    const r = req.data
    if (!r || r.content_type !== 'matriz_contenido') return
    if (r.phase !== 'pendiente' || r.paid_from_credit_id != null) return
    if (checks.some((c) => (c.count ?? 0) > 0)) return

    // Orden obligatorio del proyecto: requirement_phase_logs → requirements
    const { error: e1 } = await admin.from('requirement_phase_logs').delete().eq('requirement_id', reqId)
    if (e1) {
      console.error('[deleteMatrix] no se pudieron borrar los logs del requerimiento vinculado', reqId, e1.message)
      return
    }
    const { error: e2 } = await admin.from('requirements').delete().eq('id', reqId)
    if (e2) console.error('[deleteMatrix] no se pudo borrar el requerimiento vinculado', reqId, e2.message)
  } catch (e) {
    console.error('[deleteMatrix] error limpiando el requerimiento vinculado', reqId, e)
  }
}

export async function deleteMatrix(matrixId: string): Promise<ActionResult> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase } = ctx

  const { data: m, error: readError } = await supabase.from('content_matrices')
    .select('id, client_id, status, matrix_requirement_id').eq('id', matrixId).maybeSingle()
  if (readError) return { ok: false, error: dbError(readError, 'No se pudo leer la matriz.') }
  if (!m) return { ok: false, error: 'Matriz no encontrada.' }
  if (m.status !== 'draft') return { ok: false, error: 'Solo se puede eliminar una matriz en borrador.' }

  // 1) Borrar la matriz, solo si sigue en borrador (las piezas caen por ON DELETE CASCADE). La FK al
  //    requerimiento vive en la matriz, así que no hace falta desvincular antes. RETURNING trae el
  //    vínculo vigente al momento del borrado.
  const { data: deleted, error } = await supabase.from('content_matrices').delete()
    .eq('id', matrixId).eq('status', 'draft').select('id, matrix_requirement_id')
  if (error) return { ok: false, error: dbError(error, 'No se pudo eliminar la matriz.') }
  if (!deleted?.length) return { ok: false, error: 'La matriz cambió de estado; recarga la página.' }

  // 2) Limpieza best-effort del requerimiento: nunca falla la acción (un huérfano queda visible en
  //    el perfil del cliente y el admin puede anularlo).
  const reqId = deleted[0].matrix_requirement_id
  if (reqId) await discardMatrixRequirementIfUnused(reqId)

  revalidateMatrix(m.client_id, matrixId)
  return { ok: true }
}

// ── Piezas ───────────────────────────────────────────────────────────────────

type MatrixForItemWrite = Pick<ContentMatrix, 'id' | 'client_id' | 'status' | 'period_start' | 'period_end' | 'topics_json'>

// Tipo de retorno explícito: inferido, TS normaliza la unión a `{ error?: undefined; matrix }` y
// `'error' in m` deja de estrechar `m.error` a string.
async function loadMatrixForItemWrite(ctx: Ctx, matrixId: string): Promise<{ matrix: MatrixForItemWrite } | { error: string }> {
  const { data } = await ctx.supabase.from('content_matrices')
    .select('id, client_id, status, period_start, period_end, topics_json').eq('id', matrixId).single()
  if (!data) return { error: 'Matriz no encontrada.' }
  if (data.status === 'closed') return { error: 'La matriz está cerrada.' }
  return { matrix: data }
}

function cleanText(v: string | null | undefined): string | null {
  const s = v?.trim()
  return s ? s : null
}

export async function addItem(matrixId: string, contentType: ContentType, deadline?: string): Promise<ActionResult<{ item: ContentMatrixItem }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (!MATRIX_CONTENT_TYPES.includes(contentType)) return { ok: false, error: 'Ese tipo no se planifica en la matriz.' }

  const loaded = await safeLoad('addItem', () => loadMatrixEditorData(ctx.supabase, matrixId))
  if (!loaded.ok) return loaded
  const data = loaded.value
  if (!data) return { ok: false, error: 'Matriz no encontrada.' }
  if (data.matrix.status === 'closed') return { ok: false, error: 'La matriz está cerrada.' }

  const chosen = deadline ?? proposeDeadline({
    contentType,
    items: data.items,
    distribution: data.distribution,
    periodStart: data.period.periodStart,
    periodEnd: data.period.periodEnd,
    maxWeek: data.maxWeek,
    sharedTypes: sharedTypesFor(data.limits),
    today: today(),
  })
  const v = validateItemPatch({ deadline: chosen }, { ...data.period, topics: data.matrix.topics_json })
  if (!v.ok) return { ok: false, error: v.error }

  const { data: item, error } = await ctx.supabase.from('content_matrix_items')
    .insert({ matrix_id: matrixId, content_type: contentType, deadline: chosen })
    .select('*').single()
  if (error || !item) return { ok: false, error: dbError(error, 'No se pudo agregar la pieza.') }
  revalidateMatrix(data.matrix.client_id, matrixId)
  return { ok: true, item: item as ContentMatrixItem }
}

export async function updateItem(itemId: string, patch: ItemPatch): Promise<ActionResult<{ item: ContentMatrixItem }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase } = ctx

  // Forma del payload (barato, antes de tocar la base). content_type, objective, topic y deadline
  // se validan después con validateItemPatch.
  if (!isPlainObject(patch)) return { ok: false, error: INVALID_DATA }
  if (patch.needs_production !== undefined && typeof patch.needs_production !== 'boolean') {
    return { ok: false, error: INVALID_DATA }
  }
  const title = patch.title !== undefined ? textField(patch.title, TITLE_MAX, 'El título es demasiado largo.') : null
  if (title && !title.ok) return title
  const texts: ItemPatch = {}
  for (const f of ITEM_TEXT_FIELDS) {
    if (patch[f.key] === undefined) continue
    const r = textField(patch[f.key], f.max, f.tooLong)
    if (!r.ok) return r
    texts[f.key] = r.value
  }

  const { data: existing } = await supabase.from('content_matrix_items').select('id, matrix_id, status').eq('id', itemId).single()
  if (!existing) return { ok: false, error: 'Pieza no encontrada.' }
  if (existing.status === 'converted') return { ok: false, error: 'La pieza ya se convirtió en requerimiento; edítala desde el pipeline.' }
  const m = await loadMatrixForItemWrite(ctx, existing.matrix_id)
  if ('error' in m) return { ok: false, error: m.error }

  const v = validateItemPatch(patch, { periodStart: m.matrix.period_start, periodEnd: m.matrix.period_end, topics: m.matrix.topics_json })
  if (!v.ok) return { ok: false, error: v.error }

  const update: ItemPatch = { ...texts }
  if (patch.content_type !== undefined) update.content_type = patch.content_type
  if (title) update.title = title.value ?? ''
  if (patch.deadline !== undefined) update.deadline = patch.deadline
  if (patch.needs_production !== undefined) update.needs_production = patch.needs_production
  if (patch.objective !== undefined) update.objective = patch.objective
  if (patch.topic !== undefined) update.topic = cleanText(patch.topic)

  const { data: item, error } = await supabase.from('content_matrix_items').update(update).eq('id', itemId).select('*').single()
  if (error || !item) return { ok: false, error: dbError(error, 'No se pudo guardar la pieza.') }
  // Sin revalidateMatrix: guardado por campo, el editor aplica la fila devuelta (ver revalidateMatrix).
  return { ok: true, item: item as ContentMatrixItem }
}

export async function duplicateItem(itemId: string): Promise<ActionResult<{ item: ContentMatrixItem }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase } = ctx

  const { data: src } = await supabase.from('content_matrix_items').select('*').eq('id', itemId).single()
  if (!src) return { ok: false, error: 'Pieza no encontrada.' }
  const m = await loadMatrixForItemWrite(ctx, src.matrix_id)
  if ('error' in m) return { ok: false, error: m.error }

  const { data: item, error } = await supabase.from('content_matrix_items').insert({
    matrix_id: src.matrix_id, content_type: src.content_type, title: src.title, topic: src.topic,
    objective: src.objective, copy: src.copy, script: src.script, visual_style: src.visual_style,
    hashtags: src.hashtags, cta: src.cta, deadline: src.deadline, needs_production: src.needs_production,
  }).select('*').single()
  if (error || !item) return { ok: false, error: dbError(error, 'No se pudo duplicar la pieza.') }
  revalidateMatrix(m.matrix.client_id, m.matrix.id)
  return { ok: true, item: item as ContentMatrixItem }
}

export async function deleteItem(itemId: string): Promise<ActionResult> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase } = ctx

  const { data: existing } = await supabase.from('content_matrix_items').select('id, matrix_id, status').eq('id', itemId).single()
  if (!existing) return { ok: false, error: 'Pieza no encontrada.' }
  if (existing.status === 'converted') return { ok: false, error: 'La pieza ya se convirtió en requerimiento.' }
  const m = await loadMatrixForItemWrite(ctx, existing.matrix_id)
  if ('error' in m) return { ok: false, error: m.error }

  const { error } = await supabase.from('content_matrix_items').delete().eq('id', itemId)
  if (error) return { ok: false, error: dbError(error, 'No se pudo eliminar la pieza.') }
  revalidateMatrix(m.matrix.client_id, m.matrix.id)
  return { ok: true }
}

// ── Duplicar matriz ──────────────────────────────────────────────────────────

export async function duplicateMatrix(sourceId: string, target: { periodStart: string; periodEnd: string }): Promise<ActionResult<{ id: string; link: LinkResult }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  const { supabase, userId } = ctx

  if (!isPlainObject(target)) return { ok: false, error: INVALID_DATA }
  if (!isIsoDate(target.periodStart) || !isIsoDate(target.periodEnd)) return { ok: false, error: INVALID_PERIOD }

  const [{ data: src, error: srcError }, { data: srcItems, error: srcItemsError }] = await Promise.all([
    supabase.from('content_matrices').select('*').eq('id', sourceId).maybeSingle(),
    supabase.from('content_matrix_items').select('*').eq('matrix_id', sourceId),
  ])
  if (srcError) return { ok: false, error: dbError(srcError, 'No se pudo leer la matriz.') }
  if (!src) return { ok: false, error: 'Matriz no encontrada.' }
  // Sin esto, un fallo de lectura crearía en silencio una copia sin piezas.
  if (srcItemsError) return { ok: false, error: dbError(srcItemsError, 'No se pudieron leer las piezas de la matriz.') }
  // La unicidad es (client_id, period_start): el mismo inicio es el mismo período.
  if (target.periodStart === src.period_start) {
    return { ok: false, error: 'Elige un período distinto al de la matriz original.' }
  }
  const periodError = await validateTargetPeriod(ctx, src.client_id, target)
  if (periodError) return periodError

  const { data: existing } = await supabase.from('content_matrices').select('id')
    .eq('client_id', src.client_id).eq('period_start', target.periodStart).maybeSingle()
  if (existing) return { ok: false, error: 'Ya existe una matriz para ese período.' }

  const cycle = await resolveCycleIdForPeriod(ctx, src.client_id, target.periodStart)
  if (!cycle.ok) return cycle

  const { data: created, error } = await supabase.from('content_matrices').insert({
    client_id: src.client_id,
    period_start: target.periodStart,
    period_end: target.periodEnd,
    billing_cycle_id: cycle.id,
    title: matrixTitleFor(target.periodStart, target.periodEnd),
    topics_json: src.topics_json,
    notes: src.notes,
    lead_days: src.lead_days,
    created_by: userId,
  }).select('id').single()
  if (error || !created) return { ok: false, error: dbError(error, 'No se pudo duplicar la matriz.') }

  const from = { periodStart: src.period_start, periodEnd: src.period_end }
  const items = ((srcItems ?? []) as ContentMatrixItem[]).map((it) => ({
    matrix_id: created.id, content_type: it.content_type, title: it.title, topic: it.topic, objective: it.objective,
    copy: it.copy, script: it.script, visual_style: it.visual_style, hashtags: it.hashtags, cta: it.cta,
    deadline: shiftDeadline(it.deadline, from, target), needs_production: it.needs_production,
  }))
  if (items.length > 0) {
    const { error: itemsError } = await supabase.from('content_matrix_items').insert(items)
    if (itemsError) {
      const { error: rollbackError } = await supabase.from('content_matrices').delete().eq('id', created.id)
      if (rollbackError) console.error('[duplicateMatrix] no se pudo revertir la matriz creada', created.id, rollbackError.message)
      return { ok: false, error: dbError(itemsError, 'No se pudieron copiar las piezas de la matriz.') }
    }
  }

  const link = await linkMatrixRequirement(ctx, created.id)
  revalidateMatrix(src.client_id, created.id)
  return { ok: true, id: created.id, link }
}
