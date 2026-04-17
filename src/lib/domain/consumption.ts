import type { Consumption, ContentType, ConsumptionTotals } from '@/types/db'

/** Count non-voided consumptions by type */
export function computeTotals(consumptions: Consumption[]): ConsumptionTotals {
  const totals: ConsumptionTotals = {
    historia: 0,
    estatico: 0,
    video_corto: 0,
    reel: 0,
    short: 0,
    produccion: 0,
    reunion: 0,
  }

  for (const c of consumptions) {
    if (!c.voided && !c.carried_over) {
      totals[c.content_type]++
    }
  }

  return totals
}

/** Check if adding one more of a type would exceed the effective limit.
 *  Returns true if the consumption is allowed (has room), false if at/over limit. */
export function canConsume(
  type: ContentType,
  totals: ConsumptionTotals,
  limits: Record<ContentType, number>
): boolean {
  return totals[type] < limits[type]
}

/** Group consumptions by ISO week within a cycle period.
 *  Returns weeks S1–S4 (and S5 if needed). */
export function groupByWeek(
  consumptions: Consumption[],
  periodStart: string
): Record<string, Consumption[]> {
  const start = new Date(periodStart)
  const groups: Record<string, Consumption[]> = {}

  for (const c of consumptions) {
    if (c.voided) continue
    const date = new Date(c.registered_at)
    const diffDays = Math.floor(
      (date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
    )
    const weekNum = Math.floor(diffDays / 7) + 1
    const key = `S${weekNum}`
    if (!groups[key]) groups[key] = []
    groups[key].push(c)
  }

  return groups
}

/** Compute what could be rolled over: limit - consumed (only positive amounts) */
export function computeRollover(
  totals: ConsumptionTotals,
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
