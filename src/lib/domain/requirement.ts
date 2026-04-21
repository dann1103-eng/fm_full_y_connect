import type { Requirement, ContentType, RequirementTotals, WeeklyDistribution, WeekKey, BillingCycle, Client } from '@/types/db'

/**
 * Biweekly unlock: retorna true si la semana dada está desbloqueada por el pago correspondiente.
 * - Monthly: siempre true (el pago del ciclo cubre las 4 semanas).
 * - Biweekly: S1-S2 requieren `payment_status = 'paid'`; S3-S4 requieren `payment_status_2 = 'paid'`.
 */
export function isWeekUnlocked(
  week: 1 | 2 | 3 | 4,
  cycle: BillingCycle,
  client: Pick<Client, 'billing_period'>
): boolean {
  if (client.billing_period !== 'biweekly') return true
  if (week === 1 || week === 2) return cycle.payment_status === 'paid'
  return cycle.payment_status_2 === 'paid'
}

/**
 * Valida el pago + límite al registrar un requerimiento (biweekly aware).
 * Retorna { ok, reason }.
 */
export function canRegisterWithContext(
  type: ContentType,
  totals: RequirementTotals,
  limits: Record<ContentType, number>,
  ctx: { week: 1 | 2 | 3 | 4; cycle: BillingCycle; client: Pick<Client, 'billing_period'> }
): { ok: boolean; reason?: string } {
  if (!isWeekUnlocked(ctx.week, ctx.cycle, ctx.client)) {
    return {
      ok: false,
      reason:
        ctx.week <= 2
          ? 'Pago pendiente de 1ra quincena'
          : 'Pago pendiente de 2da quincena',
    }
  }
  if (totals[type] >= limits[type]) return { ok: false, reason: 'Límite alcanzado' }
  return { ok: true }
}

/** Calcula el índice de semana (1..4) de una fecha dentro del ciclo. S5+ se clampa a 4. */
export function weekIndexInCycle(date: Date, periodStart: string): 1 | 2 | 3 | 4 {
  const start = new Date(periodStart)
  const diffDays = Math.floor((date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  const w = Math.min(4, Math.max(1, Math.floor(diffDays / 7) + 1))
  return w as 1 | 2 | 3 | 4
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
 *  When a requirement has `includes_story = true`, it also adds +1 to `historia`,
 *  because the derived story is produced alongside the main deliverable and
 *  counts toward the monthly story quota without being a separate requirement. */
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
    totals[r.content_type]++
    if (r.includes_story) totals.historia++
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
 *  Returns weeks S1–S4 (and S5 if needed). */
export function groupByWeek(
  requirements: Requirement[],
  periodStart: string
): Record<string, Requirement[]> {
  const start = new Date(periodStart)
  const groups: Record<string, Requirement[]> = {}

  for (const r of requirements) {
    if (r.voided) continue
    const date = new Date(r.registered_at)
    const diffDays = Math.floor(
      (date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    )
    const weekNum = Math.floor(diffDays / 7) + 1
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
 * Default weekly target for a content type: monthly limit ÷ 4, rounded up.
 * Returns 0 when limit is 0 — callers can treat that as the type being inactive.
 */
export function weeklyTarget(_type: ContentType, limit: number): number {
  return Math.ceil(limit / 4)
}

/**
 * Resolve the effective weekly target for a client, falling back to the default.
 */
export function effectiveWeeklyTarget(
  type: ContentType,
  monthlyLimit: number,
  clientTargets: Partial<Record<ContentType, number>> | null | undefined
): number {
  return clientTargets?.[type] ?? weeklyTarget(type, monthlyLimit)
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
 * Build a full 4-week distribution by augmenting a base distribution with
 * equitable fallbacks (limit ÷ 4) for any pipeline types not explicitly configured.
 */
export function augmentDistribution(
  dist: WeeklyDistribution,
  pipelineTypes: ContentType[],
  limits: Record<ContentType, number>,
): WeeklyDistribution {
  const WEEKS: WeekKey[] = ['S1', 'S2', 'S3', 'S4']
  const result: WeeklyDistribution = {}
  for (const w of WEEKS) {
    result[w] = {}
    for (const type of pipelineTypes) {
      const explicit = dist[w]?.[type]
      if (explicit !== undefined) {
        result[w]![type] = explicit
      } else {
        const fallback = Math.ceil(limits[type] / 4)
        if (fallback > 0) result[w]![type] = fallback
      }
    }
  }
  return result
}

/**
 * Compute weekly breakdown with cascade overflow.
 * Each requirement fills the earliest available budget slot (S1 → S2 → S3 → S4),
 * regardless of the week it was registered in. Surplus with no room anywhere is "overflow" (shown in S4).
 */
export function computeWeeklyBreakdownWithCascade(
  requirements: Requirement[],
  distribution: WeeklyDistribution,
  currentWeekIdx: number,
): WeekBreakdown[] {
  const WEEKS: WeekKey[] = ['S1', 'S2', 'S3', 'S4']

  const remaining: WeeklyDistribution = {}
  for (const w of WEEKS) {
    remaining[w] = { ...(distribution[w] ?? {}) }
  }

  const counts: Partial<Record<ContentType, number>>[] = WEEKS.map(() => ({}))
  const overflow: Partial<Record<ContentType, number>>[] = WEEKS.map(() => ({}))

  const sorted = requirements
    .filter(r => !r.voided && !r.carried_over)
    .sort((a, b) => a.registered_at.localeCompare(b.registered_at))

  for (const r of sorted) {
    const type = r.content_type
    let weekIdx = 0  // always fill from S1 forward
    let consumed = false

    while (weekIdx < 4) {
      const budget = remaining[WEEKS[weekIdx]]?.[type] ?? 0
      if (budget > 0) {
        remaining[WEEKS[weekIdx]]![type] = budget - 1
        counts[weekIdx][type] = (counts[weekIdx][type] ?? 0) + 1
        consumed = true
        break
      }
      weekIdx++
    }

    if (!consumed) {
      overflow[3][type] = (overflow[3][type] ?? 0) + 1
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
