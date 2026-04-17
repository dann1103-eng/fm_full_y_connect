/**
 * Domain logic for billing cycle dates and status transitions.
 * Pure functions — no Supabase calls — for use in both app routes and Edge Functions.
 *
 * Cycle model (billing-day-inclusive):
 *   period_start = billing_day of month A   (clamped to last day of that month)
 *   period_end   = billing_day of month B   (clamped to last day of that month)
 *
 * e.g. billing_day=30, client created April 17 →  March 30 – April 30
 *      billing_day=31, in February          →  Jan  31 – Feb  28
 */

/** Get the last day of a given month (1-indexed month). */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/** Clamp `day` to the actual last day of the given month (month is 0-indexed). */
function clampDay(year: number, month0: number, day: number): number {
  return Math.min(day, lastDayOfMonth(year, month0 + 1))
}

/**
 * Determine the CURRENT active billing period for a given billing day.
 *
 * Rules (reference date defaults to today):
 *   - If ref.day >= billingDay of that month → period is [billingDay of this month, billingDay of next month]
 *   - If ref.day <  billingDay of that month → period is [billingDay of prev month, billingDay of this month]
 *
 * All days are clamped to the last calendar day of the respective month.
 *
 * Examples (today = 2026-04-17, billingDay = 30):
 *   → period_start = 2026-03-30, period_end = 2026-04-30
 *
 * Examples (today = 2026-04-30, billingDay = 30):
 *   → period_start = 2026-04-30, period_end = 2026-05-30
 */
export function currentCycleDates(
  billingDay: number,
  referenceDate?: string
): { periodStart: string; periodEnd: string } {
  const ref = referenceDate ? new Date(referenceDate) : new Date()
  const refDay   = ref.getDate()
  const refMonth = ref.getMonth()   // 0-indexed
  const refYear  = ref.getFullYear()

  const clampedThisMonth = clampDay(refYear, refMonth, billingDay)

  if (refDay >= clampedThisMonth) {
    // At or past billing day → current period starts this month
    const startDay = clampedThisMonth
    const periodStart = new Date(refYear, refMonth, startDay)

    const endYear  = refMonth === 11 ? refYear + 1 : refYear
    const endMonth = refMonth === 11 ? 0 : refMonth + 1
    const endDay   = clampDay(endYear, endMonth, billingDay)
    const periodEnd = new Date(endYear, endMonth, endDay)

    return {
      periodStart: periodStart.toISOString().split('T')[0],
      periodEnd:   periodEnd.toISOString().split('T')[0],
    }
  } else {
    // Before billing day → current period started last month
    const startYear  = refMonth === 0 ? refYear - 1 : refYear
    const startMonth = refMonth === 0 ? 11 : refMonth - 1
    const startDay   = clampDay(startYear, startMonth, billingDay)
    const periodStart = new Date(startYear, startMonth, startDay)

    const endDay   = clampedThisMonth
    const periodEnd = new Date(refYear, refMonth, endDay)

    return {
      periodStart: periodStart.toISOString().split('T')[0],
      periodEnd:   periodEnd.toISOString().split('T')[0],
    }
  }
}

/**
 * Compute the FIRST billing cycle when reactivating a client with an explicit start date.
 *
 * Rules:
 *   - period_start = startDate (the explicit date chosen)
 *   - period_end   = the first occurrence of billingDay that is strictly after startDate
 *                    (clamped to last day of month)
 *
 * Examples:
 *   firstCycleDates("2026-04-17", 30) → start = April 17, end = April 30
 *   firstCycleDates("2026-04-30", 30) → start = April 30, end = May   30
 *   firstCycleDates("2026-04-30", 31) → start = April 30, end = May   31
 */
export function firstCycleDates(
  startDate: string,
  billingDay: number
): { periodStart: string; periodEnd: string } {
  const start      = new Date(startDate)
  const startDay   = start.getDate()
  const startMonth = start.getMonth()   // 0-indexed
  const startYear  = start.getFullYear()

  // Clamp billingDay to the last day of startDate's month
  const clampedThisMonth = clampDay(startYear, startMonth, billingDay)

  let endYear: number
  let endMonth: number // 0-indexed

  if (startDay < clampedThisMonth) {
    // Billing day is still ahead this month
    endYear  = startYear
    endMonth = startMonth
  } else {
    // Billing day has passed (or startDay equals clamped day) → next month
    endYear  = startMonth === 11 ? startYear + 1 : startYear
    endMonth = startMonth === 11 ? 0 : startMonth + 1
  }

  const endDay    = clampDay(endYear, endMonth, billingDay)
  const periodEnd = new Date(endYear, endMonth, endDay)

  return {
    periodStart: startDate,
    periodEnd:   periodEnd.toISOString().split('T')[0],
  }
}

/**
 * Compute the NEXT cycle's dates given the previous cycle's period_end.
 *
 * Rules:
 *   - period_start = previousPeriodEnd  (the billing day is the boundary)
 *   - period_end   = billingDay of the following month (clamped)
 *
 * Examples:
 *   nextCycleDates("2026-04-30", 30) → April 30 – May   30
 *   nextCycleDates("2026-02-28", 31) → Feb   28 – March 31
 *   nextCycleDates("2026-12-30", 30) → Dec   30 – Jan   30, 2027
 */
export function nextCycleDates(
  previousPeriodEnd: string,
  billingDay: number
): { periodStart: string; periodEnd: string } {
  const prevEnd   = new Date(previousPeriodEnd)
  const prevYear  = prevEnd.getFullYear()
  const prevMonth = prevEnd.getMonth()  // 0-indexed

  // period_start = previousPeriodEnd (it's already the clamped billing day of its month)
  const periodStart = previousPeriodEnd

  // period_end = billingDay of the month following prevEnd, clamped
  const endYear  = prevMonth === 11 ? prevYear + 1 : prevYear
  const endMonth = prevMonth === 11 ? 0 : prevMonth + 1
  const endDay   = clampDay(endYear, endMonth, billingDay)
  const periodEnd = new Date(endYear, endMonth, endDay)

  return {
    periodStart,
    periodEnd: periodEnd.toISOString().split('T')[0],
  }
}

/** How many days remain until period_end (from today). Negative = overdue. */
export function daysUntilEnd(periodEnd: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = new Date(periodEnd)
  end.setHours(0, 0, 0, 0)
  return Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

/** Returns true if this cycle should appear in the renewals tray (≤ 7 days or overdue). */
export function isRenewalDue(periodEnd: string): boolean {
  return daysUntilEnd(periodEnd) <= 7
}
