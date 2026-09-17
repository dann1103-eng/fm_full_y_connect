import type { BillingCycle, BillingPeriod, ContentType, MatrixObjective, MatrixStatus, Plan, Requirement } from '@/types/db'
import { dominantCycleMonth, computeTotals } from './requirement'
import { firstCycleDates, nextCycleDates, currentCycleDates } from './cycles'
import type { DateString } from './dates'
import { formatDeadlineDate } from './deadline'
import { effectiveLimits, applyContentLimitsWithOverride, limitsToRecord } from './plans'

// ── Constantes ──────────────────────────────────────────────────────────────

/** Tipos que se planifican en una matriz (producción, reunión y matriz no). */
export const MATRIX_CONTENT_TYPES: ContentType[] = ['historia', 'estatico', 'video_corto', 'reel', 'short']

export const MATRIX_OBJECTIVES: MatrixObjective[] = ['venta', 'alcance', 'educacion', 'comunidad', 'otro']

export const MATRIX_OBJECTIVE_LABELS: Record<MatrixObjective, string> = {
  venta: 'Venta', alcance: 'Alcance', educacion: 'Educación', comunidad: 'Comunidad', otro: 'Otro',
}

export const MATRIX_STATUS_LABELS: Record<MatrixStatus, string> = {
  draft: 'Borrador', approved: 'Aprobada', closed: 'Cerrada',
}

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

// ── Períodos objetivo ───────────────────────────────────────────────────────

export interface TargetPeriod {
  periodStart: DateString
  periodEnd: DateString
  label: string
  isCurrent: boolean
}

export interface TargetPeriodsInput {
  currentCycle: { period_start: DateString; period_end: DateString } | null
  billingDay: number
  billingPeriod: BillingPeriod
  today: DateString
  count?: number
}

/** "15 oct al 14 nov 2026" */
export function periodLabel(periodStart: DateString, periodEnd: DateString): string {
  return `${formatDeadlineDate(periodStart)} al ${formatDeadlineDate(periodEnd)} ${periodEnd.slice(0, 4)}`
}

/** "Matriz octubre 2026" — mes con más días dentro del período. */
export function matrixTitleFor(periodStart: DateString, periodEnd: DateString): string {
  const { year, month } = dominantCycleMonth(periodStart, periodEnd)
  return `Matriz ${MONTHS_ES[month]} ${year}`
}

/**
 * Ciclo vigente + N-1 siguientes. Sin ciclo vigente, se calcula desde billing_day
 * (ancla mensual de `currentCycleDates`, aproximación intencional para quincenal).
 */
export function computeTargetPeriods(input: TargetPeriodsInput): TargetPeriod[] {
  const count = input.count ?? 4
  const opts = { billingPeriod: input.billingPeriod }
  let cur: { periodStart: DateString; periodEnd: DateString }
  if (input.currentCycle) {
    cur = { periodStart: input.currentCycle.period_start, periodEnd: input.currentCycle.period_end }
  } else {
    const { periodStart } = currentCycleDates(input.billingDay, input.today)
    cur = firstCycleDates(periodStart, opts)
  }
  const out: TargetPeriod[] = []
  for (let i = 0; i < count; i++) {
    out.push({ ...cur, label: periodLabel(cur.periodStart, cur.periodEnd), isCurrent: i === 0 })
    cur = nextCycleDates(cur.periodEnd, opts)
  }
  return out
}

const ZERO_TOTALS: Record<ContentType, number> = {
  historia: 0, estatico: 0, video_corto: 0, reel: 0, short: 0, produccion: 0, reunion: 0, matriz_contenido: 0,
}

// ── Cupos ───────────────────────────────────────────────────────────────────

export interface MatrixLimitsInput {
  cycle: BillingCycle | null
  plan: Plan
  cycleRequirements: Requirement[]
  credits: Partial<Record<ContentType, number>>
}

export interface MatrixLimits {
  limits: Record<ContentType, number>
  cycleTotals: Record<ContentType, number>
  credits: Partial<Record<ContentType, number>>
  unifiedPool: number | null
  estimated: boolean
}

export function resolveMatrixLimits(input: MatrixLimitsInput): MatrixLimits {
  if (input.cycle) {
    const base = effectiveLimits(input.cycle.limits_snapshot_json, input.cycle.rollover_from_previous_json)
    const limits = applyContentLimitsWithOverride(
      base,
      (input.cycle.content_limits_override_json ?? null) as Record<string, number> | null,
    )
    return {
      limits,
      cycleTotals: computeTotals(input.cycleRequirements),
      credits: input.credits,
      unifiedPool: input.cycle.limits_snapshot_json.unified_content_limit ?? null,
      estimated: false,
    }
  }
  return {
    limits: limitsToRecord(input.plan.limits_json),
    cycleTotals: { ...ZERO_TOTALS },
    credits: input.credits,
    unifiedPool: input.plan.unified_content_limit ?? null,
    estimated: true,
  }
}
