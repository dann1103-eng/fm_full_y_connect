import type { Requirement, ContentType, RequirementTotals, WeeklyDistribution, WeekKey, BillingCycle, Client } from '@/types/db'
import { today } from './dates'

// Re-export desde el nuevo módulo para mantener compatibilidad con los imports existentes.
export {
  augmentDistribution,
  applyOverride,
  addRollover,
  buildProrateOverride,
  buildAccumulateOverride,
} from './weekly-distribution'

/**
 * Período de gracia activo: si `grace_period_until >= today()` (zona local GMT-6),
 * el ciclo se trata como pagado para efectos de registro de requerimientos.
 */
export function isGracePeriodActive(cycle: Pick<BillingCycle, 'grace_period_until'>): boolean {
  if (!cycle.grace_period_until) return false
  return cycle.grace_period_until >= today()
}

/** Índice de semana válido según billing_period: 1-4 para monthly/biweekly, 1-8 para bimonthly. */
export type WeekIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/**
 * Unlock por pago: retorna true si la semana dada está desbloqueada para registrar
 * requerimientos según el estado de pago del ciclo.
 *
 * - Período de gracia vigente: TODAS las semanas desbloqueadas (override).
 * - Monthly: las 4 semanas requieren `payment_status = 'paid'`. Si el cliente
 *   no ha pagado el ciclo, NINGUNA semana está habilitada (ningún registro nuevo).
 * - Biweekly: S1-S2 requieren `payment_status = 'paid'`; S3-S4 requieren
 *   `payment_status_2 = 'paid'` — los dos pagos son independientes.
 * - Bimonthly: S1-S4 requieren `payment_status = 'paid'`; S5-S8 requieren
 *   `payment_status_2 = 'paid'`.
 */
export function isWeekUnlocked(
  week: WeekIndex,
  cycle: BillingCycle,
  client: Pick<Client, 'billing_period'>
): boolean {
  if (isGracePeriodActive(cycle)) return true
  if (client.billing_period === 'biweekly') {
    if (week <= 2) return cycle.payment_status === 'paid'
    return cycle.payment_status_2 === 'paid'
  }
  if (client.billing_period === 'bimonthly') {
    if (week <= 4) return cycle.payment_status === 'paid'
    return cycle.payment_status_2 === 'paid'
  }
  // Monthly: todo el ciclo gateado por payment_status
  return cycle.payment_status === 'paid'
}

/**
 * ¿Está TODO el ciclo bloqueado por falta de pago? Útil para deshabilitar
 * por completo el botón "Registrar requerimiento" cuando ninguna semana
 * está desbloqueada. La gracia vigente desbloquea.
 */
export function isCycleFullyLocked(
  cycle: BillingCycle,
  client: Pick<Client, 'billing_period'>
): boolean {
  if (isGracePeriodActive(cycle)) return false
  if (client.billing_period === 'biweekly' || client.billing_period === 'bimonthly') {
    return cycle.payment_status !== 'paid' && cycle.payment_status_2 !== 'paid'
  }
  return cycle.payment_status !== 'paid'
}

/**
 * Valida el pago + límite al registrar un requerimiento.
 * Retorna { ok, reason }.
 */
export function canRegisterWithContext(
  type: ContentType,
  totals: RequirementTotals,
  limits: Record<ContentType, number>,
  ctx: { week: WeekIndex; cycle: BillingCycle; client: Pick<Client, 'billing_period'> }
): { ok: boolean; reason?: string } {
  if (!isWeekUnlocked(ctx.week, ctx.cycle, ctx.client)) {
    let reason: string
    if (ctx.client.billing_period === 'biweekly') {
      reason = ctx.week <= 2
        ? 'Pago pendiente de 1ra quincena'
        : 'Pago pendiente de 2da quincena'
    } else if (ctx.client.billing_period === 'bimonthly') {
      reason = ctx.week <= 4
        ? 'Pago pendiente del 1er mes'
        : 'Pago pendiente del 2do mes'
    } else {
      reason = 'Pago pendiente del ciclo'
    }
    return { ok: false, reason }
  }
  if (totals[type] >= limits[type]) return { ok: false, reason: 'Límite alcanzado' }
  return { ok: true }
}

/**
 * Desglose efectivo de consumo de un requerimiento.
 *
 * Siempre parte de la base legacy (1 del content_type + 1 historia si includes_story)
 * y fusiona el override encima: el admin modifica cantidades específicas sin tener
 * que redeclarar los tipos que no cambian.
 *
 * Reglas:
 * - `consumption_overrides_json` = null/vacío → comportamiento 100% legacy.
 * - override[type] > 0 → ese tipo consume override[type] (reemplaza la base para ese tipo).
 * - override[type] = 0 (explícito) → ese tipo no consume nada (elimina la base).
 * - La historia de `includes_story` se incluye siempre salvo que el override la anule con 0.
 */
export function consumptionOf(
  r: Pick<Requirement, 'content_type' | 'includes_story' | 'consumption_overrides_json'>
): Partial<Record<ContentType, number>> {
  // Base siempre presente
  const result: Partial<Record<ContentType, number>> = { [r.content_type]: 1 }
  if (r.includes_story && r.content_type !== 'historia') result.historia = 1

  const o = r.consumption_overrides_json
  if (o && Object.keys(o).length > 0) {
    for (const [type, qty] of Object.entries(o)) {
      const n = Number(qty)
      if (!Number.isFinite(n)) continue
      if (n <= 0) {
        delete result[type as ContentType]   // override explícito a 0 → no cuenta
      } else {
        result[type as ContentType] = n      // override positivo → reemplaza la base para ese tipo
      }
    }
  }

  return result
}

/**
 * Valida que un breakdown completo (mapa tipo→cantidad) cabe en los límites
 * dado el consumo actual. Retorna el primer tipo que excede si lo hay.
 */
export function canRegisterBreakdown(
  breakdown: Partial<Record<ContentType, number>>,
  totals: RequirementTotals,
  limits: Record<ContentType, number>
): { ok: boolean; exceeded?: ContentType } {
  for (const [type, qty] of Object.entries(breakdown)) {
    const t = type as ContentType
    if ((totals[t] ?? 0) + (qty as number) > (limits[t] ?? 0)) {
      return { ok: false, exceeded: t }
    }
  }
  return { ok: true }
}

/**
 * Calcula el índice de semana (1..maxWeek) de una fecha dentro del ciclo.
 * maxWeek default es 4 (monthly/biweekly); para bimonthly pasar 8.
 */
export function weekIndexInCycle(
  date: Date,
  periodStart: string,
  maxWeek: 4 | 8 = 4,
): WeekIndex {
  const start = new Date(periodStart)
  const diffDays = Math.floor((date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  const w = Math.min(maxWeek, Math.max(1, Math.floor(diffDays / 7) + 1))
  return w as WeekIndex
}

/** Max semanas según billing_period: bimonthly=8, demás=4. */
export function maxWeeksForPeriod(billingPeriod: Client['billing_period']): 4 | 8 {
  return billingPeriod === 'bimonthly' ? 8 : 4
}

/** Retorna { year, month } (month 0-11) con más días dentro de [startIso, endIso).
 *  Empates se resuelven en favor del mes de `startIso` (comparación > estricta). */
export function dominantCycleMonth(startIso: string, endIso: string): { year: number; month: number } {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const counts = new Map<string, number>()
  const cursor = new Date(start)
  while (cursor < end) {
    const k = `${cursor.getFullYear()}-${cursor.getMonth()}`
    counts.set(k, (counts.get(k) ?? 0) + 1)
    cursor.setDate(cursor.getDate() + 1)
  }
  let bestKey = `${start.getFullYear()}-${start.getMonth()}`
  let bestCount = 0
  for (const [k, v] of counts) {
    if (v > bestCount) { bestCount = v; bestKey = k }
  }
  const [y, m] = bestKey.split('-').map(Number)
  return { year: y, month: m }
}

/** Count non-voided requirements by type.
 *  Si un requerimiento tiene `consumption_overrides_json` con valores, ese map
 *  define exactamente cuánto consume (multi-consumo admin). Si no, aplica la
 *  regla legacy: 1 del `content_type` + 1 a `historia` cuando `includes_story=true`. */
export function computeTotals(requirements: Requirement[]): RequirementTotals {
  const totals: RequirementTotals = {
    historia: 0,
    estatico: 0,
    video_corto: 0,
    reel: 0,
    short: 0,
    produccion: 0,
    reunion: 0,
    matriz_contenido: 0,
  }

  for (const r of requirements) {
    if (r.voided || r.carried_over) continue
    const breakdown = consumptionOf(r)
    for (const [type, qty] of Object.entries(breakdown)) {
      totals[type as ContentType] += qty as number
    }
  }

  return totals
}

/** Breakdown of historia consumption: how many are standalone requirements
 *  vs. derived stories piggybacked on other content via `includes_story`. */
export function historiaBreakdown(requirements: Requirement[]): { propias: number; derivadas: number } {
  let propias = 0
  let derivadas = 0
  for (const r of requirements) {
    if (r.voided || r.carried_over) continue
    if (r.content_type === 'historia') propias++
    if (r.includes_story) derivadas++
  }
  return { propias, derivadas }
}

/** Check if adding one more of a type would exceed the effective limit.
 *  Returns true if the requirement is allowed (has room), false if at/over limit. */
export function canRegister(
  type: ContentType,
  totals: RequirementTotals,
  limits: Record<ContentType, number>
): boolean {
  return totals[type] < limits[type]
}

/** Group requirements by ISO week within a cycle period.
 *  Returns weeks S1–SN según `maxWeek` (default 4). */
export function groupByWeek(
  requirements: Requirement[],
  periodStart: string,
  maxWeek: 4 | 8 = 4,
): Record<string, Requirement[]> {
  const start = new Date(periodStart)
  const groups: Record<string, Requirement[]> = {}

  for (const r of requirements) {
    if (r.voided) continue
    const date = new Date(r.registered_at)
    const diffDays = Math.floor(
      (date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    )
    const weekNum = Math.min(maxWeek, Math.max(1, Math.floor(diffDays / 7) + 1))
    const key = `S${weekNum}`
    if (!groups[key]) groups[key] = []
    groups[key].push(r)
  }

  return groups
}

/** Compute what could be rolled over: limit - consumed (only positive amounts) */
export function computeRollover(
  totals: RequirementTotals,
  limits: Record<ContentType, number>
): Partial<Record<ContentType, number>> {
  const rollover: Partial<Record<ContentType, number>> = {}
  const types: ContentType[] = ['historia', 'estatico', 'video_corto', 'reel', 'short', 'produccion', 'reunion']
  // nota: matriz_contenido se excluye del rollover intencionalmente

  for (const type of types) {
    const unused = limits[type] - totals[type]
    if (unused > 0) rollover[type] = unused
  }

  return rollover
}

/**
 * Default weekly target for a content type: limit ÷ N semanas, rounded up.
 * Para bimonthly se divide entre 8; monthly/biweekly entre 4.
 * Returns 0 when limit is 0 — callers can treat that as the type being inactive.
 */
export function weeklyTarget(_type: ContentType, limit: number, weeks: 4 | 8 = 4): number {
  return Math.ceil(limit / weeks)
}

/**
 * Resolve the effective weekly target for a client, falling back to the default.
 * Pass `weeks=8` para clientes bimonthly.
 */
export function effectiveWeeklyTarget(
  type: ContentType,
  monthlyLimit: number,
  clientTargets: Partial<Record<ContentType, number>> | null | undefined,
  weeks: 4 | 8 = 4,
): number {
  return clientTargets?.[type] ?? weeklyTarget(type, monthlyLimit, weeks)
}

/** Resolve the active weekly distribution: client override → plan default → null */
export function resolveDistribution(
  clientDist: WeeklyDistribution | null | undefined,
  planDist: WeeklyDistribution | null | undefined,
): WeeklyDistribution | null {
  return clientDist ?? planDist ?? null
}

export interface WeekBreakdown {
  label: WeekKey
  counts: Partial<Record<ContentType, number>>
  budget: Partial<Record<ContentType, number>>
  overflow: Partial<Record<ContentType, number>>
  isCurrent: boolean
}

/**
 * Compute weekly breakdown with cascade overflow.
 * Each requirement fills the earliest available budget slot (S1 → S2 → ... → SN),
 * regardless of the week it was registered in. Surplus with no room anywhere is "overflow"
 * (shown in la última semana). `maxWeek` define cuántas semanas considerar (4 default, 8 para bimonthly).
 */
export function computeWeeklyBreakdownWithCascade(
  requirements: Requirement[],
  distribution: WeeklyDistribution,
  currentWeekIdx: number,
  maxWeek: 4 | 8 = 4,
): WeekBreakdown[] {
  const WEEKS: WeekKey[] = (
    maxWeek === 8
      ? ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']
      : ['S1', 'S2', 'S3', 'S4']
  ) as WeekKey[]

  const remaining: WeeklyDistribution = {}
  for (const w of WEEKS) {
    remaining[w] = { ...(distribution[w] ?? {}) }
  }

  const counts: Partial<Record<ContentType, number>>[] = WEEKS.map(() => ({}))
  const overflow: Partial<Record<ContentType, number>>[] = WEEKS.map(() => ({}))
  const lastIdx = WEEKS.length - 1

  const sorted = requirements
    .filter(r => !r.voided && !r.carried_over)
    .sort((a, b) => a.registered_at.localeCompare(b.registered_at))

  function fillCascade(type: ContentType) {
    let weekIdx = 0
    let consumed = false
    while (weekIdx < WEEKS.length) {
      const budget = remaining[WEEKS[weekIdx]]?.[type] ?? 0
      if (budget > 0) {
        remaining[WEEKS[weekIdx]]![type] = budget - 1
        counts[weekIdx][type] = (counts[weekIdx][type] ?? 0) + 1
        consumed = true
        break
      }
      weekIdx++
    }
    if (!consumed) overflow[lastIdx][type] = (overflow[lastIdx][type] ?? 0) + 1
  }

  for (const r of sorted) {
    const breakdown = consumptionOf(r)
    for (const [type, qty] of Object.entries(breakdown)) {
      for (let i = 0; i < (qty as number); i++) {
        fillCascade(type as ContentType)
      }
    }
  }

  return WEEKS.map((w, i) => ({
    label: w,
    counts: counts[i],
    budget: distribution[w] ?? {},
    overflow: overflow[i],
    isCurrent: i === currentWeekIdx,
  }))
}
