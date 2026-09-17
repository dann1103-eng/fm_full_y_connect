/**
 * Núcleo de conversión de una pieza de matriz en requerimiento del pipeline.
 *
 * Lo usan igual el barrido diario (`/api/matrices/convert`, con cliente admin) y la acción manual
 * `convertItemNow` (con el cliente autenticado): el candado de pago es un trigger de base de datos,
 * así que la misma función sirve para ambos y el trigger aplica donde corresponde.
 *
 * Diseño: docs/superpowers/specs/2026-09-17-creador-de-matrices-bloque-2-design.md
 */
import { createAdminClient } from '@/lib/supabase/admin'
import type { BillingCycle, ContentMatrix, ContentMatrixItem, Requirement } from '@/types/db'
import { effectiveLimits, applyContentLimitsWithOverride, applyUnifiedPool } from '@/lib/domain/plans'
import { computeTotals } from '@/lib/domain/requirement'
import { insertInitialPhaseLog } from '@/lib/domain/pipeline'
import type { Db } from './matrices'

export type ConvertOutcome =
  | { kind: 'converted'; requirementId: string }
  | { kind: 'blocked'; reason: string }
  // `skipped` cubre tres casos y el motivo los distingue: otro proceso ganó, matriz no aprobada,
  // o fallo transitorio (se reintenta al día siguiente, sin marcar la pieza).
  | { kind: 'skipped'; reason: string }

/** Requerimientos del ciclo ya leídos en esta corrida, por `billing_cycle_id`. */
export type CycleRequirementsCache = Map<string, Requirement[]>

const REASON_BUSY = 'La pieza ya no está disponible para convertir.'
const REASON_NOT_APPROVED = 'La matriz no está aprobada.'
const NO_CYCLE = 'El cliente no tiene ciclo vigente.'
const BLOCKED_REASON_MAX = 500

type ItemWithMatrix = ContentMatrixItem & { matrix: ContentMatrix }

export async function convertMatrixItem(
  db: Db,
  itemId: string,
  opts: { registeredByUserId?: string; cache?: CycleRequirementsCache } = {},
): Promise<ConvertOutcome> {
  // 1. Pieza + matriz
  const { data: raw, error: readErr } = await db
    .from('content_matrix_items')
    .select('*, matrix:content_matrices!inner(*)')
    .eq('id', itemId)
    .maybeSingle()
  if (readErr) return { kind: 'skipped', reason: readErr.message }
  if (!raw) return { kind: 'skipped', reason: REASON_BUSY }
  const item = raw as unknown as ItemWithMatrix
  const matrix = item.matrix
  // Solo se convierten piezas `planned`/`blocked`; una ya convertida no se toca.
  if (item.status !== 'planned' && item.status !== 'blocked') return { kind: 'skipped', reason: REASON_BUSY }
  if (matrix.status !== 'approved') return { kind: 'skipped', reason: REASON_NOT_APPROVED }

  // 2. Ciclo vigente del cliente (decisión de diseño: SIEMPRE el vigente, no el del período)
  const { data: cycles, error: cycleErr } = await db
    .from('billing_cycles').select('*')
    .eq('client_id', matrix.client_id).eq('status', 'current')
    .order('created_at', { ascending: false }).limit(1)
  if (cycleErr) return { kind: 'skipped', reason: cycleErr.message }
  const cycle = (cycles?.[0] as BillingCycle | undefined) ?? null
  if (!cycle) return await markBlocked(db, itemId, NO_CYCLE)

  // 3. Fuera de cupo — misma cadena que el registro manual, pool unificado incluido. Sin
  //    `applyUnifiedPool`, en un plan con pool los límites por tipo valen 0 en el snapshot y
  //    TODA pieza nacería `over_limit: true`.
  let cycleReqs = opts.cache?.get(cycle.id)
  if (!cycleReqs) {
    // `.eq('approval_status','approved')`: computeTotals no filtra por aprobación, y sin esto las
    // solicitudes `pending` del portal contarían como cupo ya consumido.
    const { data, error } = await db.from('requirements').select('*')
      .eq('billing_cycle_id', cycle.id).eq('approval_status', 'approved')
    if (error) return { kind: 'skipped', reason: error.message }
    cycleReqs = (data ?? []) as Requirement[]
    opts.cache?.set(cycle.id, cycleReqs)
  }
  const totals = computeTotals(cycleReqs)
  const limits = applyUnifiedPool(
    applyContentLimitsWithOverride(
      effectiveLimits(cycle.limits_snapshot_json, cycle.rollover_from_previous_json),
      (cycle.content_limits_override_json ?? null) as Record<string, number> | null,
    ),
    cycle.limits_snapshot_json,
    totals,
  )
  const overLimit = (totals[item.content_type] ?? 0) >= (limits[item.content_type] ?? 0)

  // 4. Requerimiento
  const registeredBy = opts.registeredByUserId ?? matrix.approved_by ?? matrix.created_by
  const { data: req, error: insertErr } = await db.from('requirements').insert({
    billing_cycle_id: cycle.id,
    content_type: item.content_type,
    title: item.title || 'Contenido de matriz',
    deadline: item.deadline,
    assigned_to: item.assigned_to && item.assigned_to.length > 0 ? item.assigned_to : null,
    estimated_time_minutes: item.estimated_time_minutes,
    registered_by_user_id: registeredBy,
    priority: 'media',
    over_limit: overLimit,
    approval_status: 'approved',
    includes_story: false,
    requested_via: 'staff',
    notes: null,
  }).select('*').single()
  // El trigger requirements_check_week_payment_trg rechaza aquí si la semana no está pagada o el
  // cliente está suspendido; su mensaje ya viene en español y se guarda tal cual.
  if (insertErr || !req) return await markBlocked(db, itemId, insertErr?.message ?? 'No se pudo registrar el requerimiento.')

  // 5. Log inicial de fase (igual que el registro manual)
  await insertInitialPhaseLog(db, { requirementId: req.id, movedBy: registeredBy })

  // 6. Marcar la pieza (condicional: si otro proceso ganó, deshacer)
  const { data: updated, error: updErr } = await db.from('content_matrix_items')
    .update({ status: 'converted', requirement_id: req.id, converted_at: new Date().toISOString(), blocked_reason: null })
    .eq('id', itemId).in('status', ['planned', 'blocked'])
    .select('id')
  if (updErr || !updated || updated.length === 0) {
    await rollbackRequirement(req.id, cycle.id, opts.cache)
    return { kind: 'skipped', reason: updErr?.message ?? REASON_BUSY }
  }

  opts.cache?.set(cycle.id, [...cycleReqs, req as Requirement])
  return { kind: 'converted', requirementId: req.id }
}

/** Marca la pieza como bloqueada. Solo si sigue `planned`/`blocked`. */
async function markBlocked(db: Db, itemId: string, reason: string): Promise<ConvertOutcome> {
  const clean = reason.slice(0, BLOCKED_REASON_MAX)
  const { error } = await db.from('content_matrix_items')
    .update({ status: 'blocked', blocked_reason: clean })
    .eq('id', itemId).in('status', ['planned', 'blocked'])
  if (error) console.error('[matrix-convert] no se pudo marcar bloqueada', itemId, error.message)
  return { kind: 'blocked', reason: clean }
}

/**
 * Borra el requerimiento recién creado. SIEMPRE con el cliente admin: `requirements` tiene RLS y
 * no existe policy `for delete`, así que un delete autenticado devolvería 0 filas sin error y
 * dejaría un requerimiento huérfano consumiendo cupo. `requirement_phase_logs` cae por cascade.
 */
async function rollbackRequirement(reqId: string, cycleId: string, cache?: CycleRequirementsCache): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from('requirements').delete().eq('id', reqId)
  if (error) console.error('[matrix-convert] rollback falló', reqId, error.message)
  if (!cache) return
  const cached = cache.get(cycleId)
  if (cached) cache.set(cycleId, cached.filter((r) => r.id !== reqId))
}
