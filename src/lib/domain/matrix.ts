import type { BillingCycle, BillingPeriod, ContentMatrixItem, ContentType, MatrixObjective, MatrixStatus, Plan, Requirement, WeeklyDistribution } from '@/types/db'
import { WEEKS_BASE, WEEKS_BIMONTHLY } from '@/types/db'
import { dominantCycleMonth, computeTotals, weekIndexInCycle } from './requirement'
import { firstCycleDates, nextCycleDates, currentCycleDates } from './cycles'
import type { DateString } from './dates'
import { addDaysString } from './dates'
import { formatDeadlineDate } from './deadline'
import { effectiveLimits, applyContentLimitsWithOverride, limitsToRecord, TIPPABLE_CONTENT_TYPES, CONTENT_TYPES } from './plans'

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

// ── Uso y marca fuera de plan ───────────────────────────────────────────────

export interface MatrixUsageByType {
  planned: number
  used: number
  limit: number
  credits: number
  over: number
}

export interface MatrixUsage {
  byType: Record<ContentType, MatrixUsageByType>
  pool: { used: number; limit: number; credits: number } | null
  /** Ids de piezas que exceden el cupo (array, no Set: cruza la frontera server → client). */
  overPlanItemIds: string[]
  /** Tipos que muestran chip y alimentan el selector "Agregar pieza". */
  activeTypes: ContentType[]
}

export type UsageItem = Pick<ContentMatrixItem, 'id' | 'content_type' | 'deadline' | 'created_at' | 'status'>

export type UsageTone = 'neutral' | 'full' | 'over'

export function usageTone(used: number, limit: number, credits: number): UsageTone {
  if (used > limit + credits) return 'over'
  if (used === limit) return 'full'
  return 'neutral'
}

function isPoolType(t: ContentType): boolean {
  return (TIPPABLE_CONTENT_TYPES as ContentType[]).includes(t)
}

export function computeMatrixUsage(items: UsageItem[], ml: MatrixLimits): MatrixUsage {
  const planned: Record<ContentType, number> = { ...ZERO_TOTALS }
  for (const it of items) if (it.status !== 'converted') planned[it.content_type] += 1

  const byType = {} as Record<ContentType, MatrixUsageByType>
  for (const t of CONTENT_TYPES) {
    const limit = ml.limits[t] ?? 0
    const credits = ml.credits[t] ?? 0
    const used = (ml.cycleTotals[t] ?? 0) + planned[t]
    byType[t] = { planned: planned[t], used, limit, credits, over: Math.max(0, used - limit - credits) }
  }

  const pool = ml.unifiedPool != null
    ? {
        used: TIPPABLE_CONTENT_TYPES.reduce((s, t) => s + byType[t].used, 0),
        limit: ml.unifiedPool,
        credits: TIPPABLE_CONTENT_TYPES.reduce((s, t) => s + (ml.credits[t] ?? 0), 0),
      }
    : null

  const sorted = items
    .filter((i) => i.status !== 'converted')
    .slice()
    .sort((a, b) => a.deadline.localeCompare(b.deadline) || a.created_at.localeCompare(b.created_at))

  const counters: Record<ContentType, number> = { ...ml.cycleTotals }
  let poolCounter = pool ? TIPPABLE_CONTENT_TYPES.reduce((s, t) => s + (ml.cycleTotals[t] ?? 0), 0) : 0
  const overPlanItemIds: string[] = []
  for (const it of sorted) {
    const t = it.content_type
    if (pool && isPoolType(t)) {
      poolCounter += 1
      if (poolCounter > pool.limit + pool.credits) overPlanItemIds.push(it.id)
    } else {
      counters[t] = (counters[t] ?? 0) + 1
      if (counters[t] > (ml.limits[t] ?? 0) + (ml.credits[t] ?? 0)) overPlanItemIds.push(it.id)
    }
  }

  const activeTypes = MATRIX_CONTENT_TYPES.filter((t) => {
    if (pool && isPoolType(t)) return true
    const u = byType[t]
    return u.limit > 0 || u.credits > 0 || u.planned > 0
  })

  return { byType, pool, overPlanItemIds, activeTypes }
}

// ── Fecha propuesta ─────────────────────────────────────────────────────────

/**
 * Límites que alimentan la distribución semanal. Bajo pool unificado los tippables
 * tienen límite individual 0, así que se les asigna el pool para que `augmentDistribution`
 * les dé presupuesto; `proposeDeadline` los cuenta juntos vía `sharedTypes`.
 */
export function limitsForDistribution(ml: MatrixLimits): Record<ContentType, number> {
  if (ml.unifiedPool == null) return ml.limits
  const out = { ...ml.limits }
  for (const t of TIPPABLE_CONTENT_TYPES) out[t] = ml.unifiedPool
  return out
}

export interface ProposeDeadlineInput {
  contentType: ContentType
  items: Pick<ContentMatrixItem, 'content_type' | 'deadline'>[]
  distribution: WeeklyDistribution
  periodStart: DateString
  periodEnd: DateString
  maxWeek: 4 | 8
  /** Tipos que comparten presupuesto semanal (pool). Si incluye contentType, `used` los cuenta todos. */
  sharedTypes?: ContentType[]
}

export function proposeDeadline(input: ProposeDeadlineInput): DateString {
  const weeks = input.maxWeek === 8 ? WEEKS_BIMONTHLY : WEEKS_BASE
  const family: ContentType[] = input.sharedTypes?.includes(input.contentType) ? input.sharedTypes : [input.contentType]

  const usedByWeek = new Map<number, number>()
  for (const it of input.items) {
    if (!family.includes(it.content_type)) continue
    // new Date(iso) → medianoche UTC, igual que el new Date(periodStart) interno de weekIndexInCycle
    const w = weekIndexInCycle(new Date(it.deadline), input.periodStart, input.maxWeek)
    usedByWeek.set(w, (usedByWeek.get(w) ?? 0) + 1)
  }

  let chosen: number = input.maxWeek
  for (let w = 1; w <= input.maxWeek; w++) {
    const budget = input.distribution[weeks[w - 1]]?.[input.contentType] ?? 0
    if ((usedByWeek.get(w) ?? 0) < budget) { chosen = w; break }
  }

  const candidate = addDaysString(input.periodStart, (chosen - 1) * 7 + 2)
  return candidate > input.periodEnd ? input.periodEnd : candidate
}
