/**
 * Helpers puros para la automatización de facturación.
 *
 * Reglas principales:
 *   - Auto-facturación: 10 días antes del cierre del ciclo actual se crea la factura
 *     para el siguiente ciclo (monthly) o la factura biweekly_half='first' del siguiente
 *     ciclo (biweekly).
 *   - La factura biweekly_half='second' se crea reactivamente cuando la primera se paga,
 *     no en el cron.
 *   - Cliente nuevo: sólo en este caso se factura el ciclo actual — manual.
 */

import type { BillingCycle, BillingPeriod, Invoice } from '@/types/db'
import { daysUntilEnd, nextCycleDates } from './cycles'
import type { DateString } from './dates'
import { formatDateEs, parseDate } from './dates'

export const AUTO_INVOICE_LEAD_DAYS = 10

/**
 * ¿Debemos generar ya la factura automática para el siguiente ciclo?
 *
 * Condiciones:
 *   - Faltan ≤ 10 días para el cierre del ciclo actual.
 *   - No existe todavía una factura 'issued' o 'paid' para el ciclo siguiente del mismo cliente.
 */
export function shouldGenerateNextCycleInvoice(
  currentPeriodEnd: DateString,
  existingNextCycleInvoices: Pick<Invoice, 'status' | 'biweekly_half'>[],
  billingPeriod: BillingPeriod,
  today?: DateString,
): boolean {
  if (daysUntilEnd(currentPeriodEnd, today) > AUTO_INVOICE_LEAD_DAYS) return false

  if (billingPeriod === 'biweekly') {
    // Sólo necesitamos comprobar que no exista la factura 'first' del ciclo siguiente.
    return !existingNextCycleInvoices.some(
      (inv) => inv.biweekly_half === 'first' && inv.status !== 'void',
    )
  }

  return !existingNextCycleInvoices.some(
    (inv) => inv.biweekly_half === null && inv.status !== 'void',
  )
}

/**
 * ¿Debemos generar la factura biweekly_half='second' tras marcar la 'first' como paid?
 */
export function shouldGenerateBiweeklySecond(
  firstInvoice: Pick<Invoice, 'status' | 'biweekly_half' | 'billing_cycle_id'>,
  existingCycleInvoices: Pick<Invoice, 'status' | 'biweekly_half'>[],
): boolean {
  if (firstInvoice.biweekly_half !== 'first') return false
  if (firstInvoice.status !== 'paid') return false
  return !existingCycleInvoices.some(
    (inv) => inv.biweekly_half === 'second' && inv.status !== 'void',
  )
}

/**
 * Devuelve las fechas del siguiente ciclo a partir del ciclo actual.
 */
export function computeNextCyclePeriod(
  currentCycle: Pick<BillingCycle, 'period_end'>,
  billingPeriod: BillingPeriod,
) {
  return nextCycleDates(currentCycle.period_end, { billingPeriod })
}

/**
 * Etiqueta legible para el item precargado de la factura.
 *   - monthly: "abril 2026"
 *   - biweekly first: "01 al 15 de abril"
 *   - biweekly second: "16 al 30 de abril"
 */
export function invoicePeriodLabel(
  periodStart: DateString,
  periodEnd: DateString,
  billingPeriod: BillingPeriod,
  half: 'first' | 'second' | null,
): string {
  if (billingPeriod === 'biweekly' && half) {
    const start = parseDate(periodStart)
    const end = parseDate(periodEnd)
    const startDay = start.getDate().toString().padStart(2, '0')
    const endDay = end.getDate().toString().padStart(2, '0')
    const monthName = start.toLocaleDateString('es-ES', { month: 'long' })
    return `${startDay} al ${endDay} de ${monthName}`
  }
  // Monthly: mes + año del periodo
  const start = parseDate(periodStart)
  const monthName = start.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
  return monthName
}

/**
 * Rango de fechas formateado para mostrar en UI/banners.
 */
export function formatPeriodRange(periodStart: DateString, periodEnd: DateString): string {
  return `${formatDateEs(periodStart, { withYear: false })} — ${formatDateEs(periodEnd)}`
}
