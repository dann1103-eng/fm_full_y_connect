/**
 * Lógica de cálculo de ciclos de facturación — reescrita desde cero.
 *
 * Principios:
 *   - Todas las funciones son puras y timezone-safe (usan date-fns vía `./dates`).
 *   - Contratos string-in / string-out (YYYY-MM-DD) para evitar fugas de `Date` entre capas.
 *   - El ciclo mensual dura un mes completo: period_end = period_start + 1 mes - 1 día.
 *     El siguiente ciclo inicia al día después del periodEnd anterior.
 *   - `billing_day` ya NO afecta a los límites del ciclo — sólo marca el día de cobro
 *     dentro del ciclo (uso en recordatorios). Esta función deliberadamente lo ignora.
 *
 * Ejemplos (monthly):
 *   firstCycleDates("2026-04-15")  → { start: "2026-04-15", end: "2026-05-14" }
 *   firstCycleDates("2026-03-19")  → { start: "2026-03-19", end: "2026-04-18" }
 *   firstCycleDates("2026-01-31")  → { start: "2026-01-31", end: "2026-02-27" }   // clamp febrero no-bisiesto
 *   firstCycleDates("2028-01-31")  → { start: "2028-01-31", end: "2028-02-28" }   // clamp febrero bisiesto
 *   firstCycleDates("2026-12-15")  → { start: "2026-12-15", end: "2027-01-14" }
 *   nextCycleDates("2026-05-14")   → { start: "2026-05-15", end: "2026-06-14" }
 *
 * Ejemplos (biweekly — 14 días inclusivos):
 *   firstCycleDates("2026-04-15", { billingPeriod: "biweekly" })
 *     → { start: "2026-04-15", end: "2026-04-28" }
 */

import type { DateString } from './dates'
import {
  addMonthsClamped,
  subtractDay,
  addDay,
  addDaysString,
  daysBetween,
  parseDate,
  formatDate,
  today as todayString,
} from './dates'

export type BillingPeriod = 'monthly' | 'biweekly'

interface CycleOptions {
  billingPeriod?: BillingPeriod
}

export function firstCycleDates(
  startDate: DateString,
  options?: CycleOptions,
): { periodStart: DateString; periodEnd: DateString } {
  const periodStart = startDate
  const periodEnd =
    options?.billingPeriod === 'biweekly'
      ? addDaysString(startDate, 13)
      : subtractDay(addMonthsClamped(startDate, 1))

  return { periodStart, periodEnd }
}

export function nextCycleDates(
  previousPeriodEnd: DateString,
  options?: CycleOptions,
): { periodStart: DateString; periodEnd: DateString } {
  const periodStart = addDay(previousPeriodEnd)
  return firstCycleDates(periodStart, options)
}

/**
 * Calcula el period_start virtual según el día de facturación — usado por ClientForm
 * como valor por defecto del datepicker (la última ocurrencia del billing_day en o
 * antes del referenceDate). El periodEnd se calcula con la semántica nueva.
 */
export function currentCycleDates(
  billingDay: number,
  referenceDate?: DateString,
): { periodStart: DateString; periodEnd: DateString } {
  const ref = referenceDate ? parseDate(referenceDate) : new Date()
  const refYear = ref.getFullYear()
  const refMonth = ref.getMonth()
  const refDay = ref.getDate()

  const daysInThisMonth = new Date(refYear, refMonth + 1, 0).getDate()
  const clampedThisMonth = Math.min(billingDay, daysInThisMonth)

  let startYear: number
  let startMonth: number
  let startDay: number

  if (refDay >= clampedThisMonth) {
    startYear = refYear
    startMonth = refMonth
    startDay = clampedThisMonth
  } else {
    startYear = refMonth === 0 ? refYear - 1 : refYear
    startMonth = refMonth === 0 ? 11 : refMonth - 1
    const daysInPrev = new Date(startYear, startMonth + 1, 0).getDate()
    startDay = Math.min(billingDay, daysInPrev)
  }

  const periodStart = formatDate(new Date(startYear, startMonth, startDay))
  return firstCycleDates(periodStart)
}

/** Días entre hoy (o `referenceDate`) y period_end. Negativo = vencido. */
export function daysUntilEnd(periodEnd: DateString, referenceDate?: DateString): number {
  const today = referenceDate ?? todayString()
  return daysBetween(today, periodEnd)
}

/** Un ciclo entra a la bandeja de renovaciones si faltan ≤ 7 días o ya venció. */
export function isRenewalDue(periodEnd: DateString, referenceDate?: DateString): boolean {
  return daysUntilEnd(periodEnd, referenceDate) <= 7
}
