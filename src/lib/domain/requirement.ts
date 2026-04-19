import type { Requirement, ContentType, RequirementTotals } from '@/types/db'

/** Count non-voided requirements by type */
export function computeTotals(requirements: Requirement[]): RequirementTotals {
  const totals: RequirementTotals = {
    historia: 0,
    estatico: 0,
    video_corto: 0,
    reel: 0,
    short: 0,
    produccion: 0,
    reunion: 0,
  }

  for (const r of requirements) {
    if (!r.voided && !r.carried_over) {
      totals[r.content_type]++
    }
  }

  return totals
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
