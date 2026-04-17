/**
 * Domain logic for billing cycle dates and status transitions.
 * Pure functions — no Supabase calls — for use in both app routes and Edge Functions.
 */

/** Add N months to a date, clamping to the last day of the resulting month */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  const targetMonth = result.getMonth() + months
  result.setMonth(targetMonth)

  // If the day overflowed (e.g., Jan 31 + 1 month = Mar 3), clamp to end of month
  if (result.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    result.setDate(0) // last day of previous (intended) month
  }

  return result
}

/** Get the last day of a given month (1-indexed) in a given year */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/**
 * Compute the first billing cycle's period_start and period_end.
 *
 * Rules:
 * - period_start = start_date
 * - period_end   = billing_day - 1 of the month following start_date
 *                  (clamped to last day of that month if billing_day > days in month)
 */
export function firstCycleDates(
  startDate: string,
  billingDay: number
): { periodStart: string; periodEnd: string } {
  const start = new Date(startDate)
  const startYear = start.getFullYear()
  const startMonth = start.getMonth() // 0-indexed

  // period_end is billing_day - 1 of the next month
  const nextMonth = startMonth + 2 // 1-indexed month number of "next month"
  const nextYear = startMonth === 11 ? startYear + 1 : startYear
  const actualNextMonth = startMonth === 11 ? 1 : startMonth + 2 // 1-indexed

  const lastDay = lastDayOfMonth(nextYear, actualNextMonth)
  const endDay = Math.min(billingDay - 1, lastDay)

  // Handle billing_day === 1: period_end is last day of current month
  const periodEnd =
    billingDay === 1
      ? new Date(startYear, startMonth + 1, 0)
      : new Date(nextYear, actualNextMonth - 1, endDay)

  return {
    periodStart: startDate,
    periodEnd: periodEnd.toISOString().split('T')[0],
  }
}

/**
 * Compute the next cycle's period_start and period_end given the previous period_end.
 *
 * Rules:
 * - period_start = period_end + 1 day
 * - period_end   = billing_day - 1 of the month after that
 *                  (clamped to last day of the month)
 */
export function nextCycleDates(
  previousPeriodEnd: string,
  billingDay: number
): { periodStart: string; periodEnd: string } {
  const prevEnd = new Date(previousPeriodEnd)
  const nextStart = new Date(prevEnd)
  nextStart.setDate(prevEnd.getDate() + 1)

  const year = nextStart.getFullYear()
  const month = nextStart.getMonth() // 0-indexed

  // period_end is billing_day - 1 in the following month
  const endMonth = month === 11 ? 0 : month + 1 // 0-indexed
  const endYear = month === 11 ? year + 1 : year
  const lastDay = lastDayOfMonth(endYear, endMonth + 1)
  const endDay = Math.min(billingDay - 1 < 1 ? lastDay : billingDay - 1, lastDay)

  const periodEnd =
    billingDay === 1
      ? new Date(year, month + 1, 0) // last day of current month
      : new Date(endYear, endMonth, endDay)

  return {
    periodStart: nextStart.toISOString().split('T')[0],
    periodEnd: periodEnd.toISOString().split('T')[0],
  }
}

/** How many days remain until period_end (from today) */
export function daysUntilEnd(periodEnd: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = new Date(periodEnd)
  end.setHours(0, 0, 0, 0)
  return Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

/** Returns true if this cycle should appear in the renewals tray (≤ 7 days or overdue) */
export function isRenewalDue(periodEnd: string): boolean {
  return daysUntilEnd(periodEnd) <= 7
}
