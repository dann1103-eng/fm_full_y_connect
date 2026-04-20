import type { Requirement, ContentType, RequirementTotals, WeeklyDistribution, WeekKey } from '@/types/db'

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
 * Requirements registered in a given week consume that week's budget first;
 * if exhausted, they spill into subsequent weeks. Surplus with nowhere to go is "overflow".
 */
export function computeWeeklyBreakdownWithCascade(
  requirements: Requirement[],
  distribution: WeeklyDistribution,
  periodStart: string,
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
    const diffDays = Math.floor(
      (new Date(r.registered_at).getTime() - new Date(periodStart).getTime()) / 86400000
    )
    const origWeekIdx = Math.min(Math.max(Math.floor(diffDays / 7), 0), 3)
    let weekIdx = origWeekIdx
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
      overflow[origWeekIdx][type] = (overflow[origWeekIdx][type] ?? 0) + 1
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
