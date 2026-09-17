import type { BillingCycle, BillingPeriod, ClientStatus, ContentMatrixItem, ContentType, CycleStatus,MatrixObjective, MatrixStatus, MatrixTopic, Plan, Requirement, WeeklyDistribution } from '@/types/db'
import { CONTENT_TYPE_TO_CREDIT_KIND, CREDIT_KIND_TO_CONTENT_TYPE, WEEKS_BASE, WEEKS_BIMONTHLY } from '@/types/db'
import { computeTotals, consumptionOf, weekIndexInCycle } from './requirement'
import { firstCycleDates, nextCycleDates, currentCycleDates } from './cycles'
import type { DateString } from './dates'
import { addDaysString, daysBetween, formatDate, parseDate } from './dates'
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

/** Estados de cliente para los que se puede crear una matriz (diálogo y acciones de servidor). */
export const MATRIX_CREATABLE_CLIENT_STATUSES: ClientStatus[] = ['active', 'paused', 'overdue']

export function canCreateMatrixForClient(status: ClientStatus): boolean {
  return (MATRIX_CREATABLE_CLIENT_STATUSES as ClientStatus[]).includes(status)
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

/**
 * "Matriz octubre 2026" — mes con más días dentro del período.
 * Cuenta días por string (`YYYY-MM-DD`, `addDaysString`) en vez de `Date` + getters locales:
 * eso evita que el resultado dependa de la zona horaria del proceso (ver dominantCycleMonth,
 * que sí mezcla `new Date(iso)` en UTC con getters locales y por eso corre el día en UTC-6).
 */
export function matrixTitleFor(periodStart: DateString, periodEnd: DateString): string {
  const counts = new Map<string, number>()
  let d = periodStart
  while (d < periodEnd) {
    const key = d.slice(0, 7) // "YYYY-MM"
    counts.set(key, (counts.get(key) ?? 0) + 1)
    d = addDaysString(d, 1)
  }
  let bestKey = periodStart.slice(0, 7)
  let bestCount = 0
  for (const [key, count] of counts) {
    if (count > bestCount) { bestCount = count; bestKey = key }
  }
  const [yearStr, monthStr] = bestKey.split('-')
  return `Matriz ${MONTHS_ES[Number(monthStr) - 1]} ${yearStr}`
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

const CYCLE_STATUS_RANK: Record<CycleStatus, number> = { current: 0, pending_renewal: 1, scheduled: 2, archived: 3 }

/**
 * Cuando varios billing_cycles comparten `period_start`, elige el que representa el período:
 * current > pending_renewal > scheduled > archived; a igual estado, el `created_at` más reciente.
 */
export function pickCycleForPeriod<T extends Pick<BillingCycle, 'status' | 'created_at'>>(cycles: readonly T[]): T | null {
  let best: T | null = null
  for (const c of cycles) {
    if (!best) { best = c; continue }
    const rc = CYCLE_STATUS_RANK[c.status] ?? Number.MAX_SAFE_INTEGER
    const rb = CYCLE_STATUS_RANK[best.status] ?? Number.MAX_SAFE_INTEGER
    if (rc < rb || (rc === rb && new Date(c.created_at).getTime() > new Date(best.created_at).getTime())) best = c
  }
  return best
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
  /**
   * Créditos que amplían el cupo. Con ciclo: los que quedan (`qty_remaining`) MÁS los que ya consumieron
   * requerimientos del ciclo que cuentan en `cycleTotals` — si no, esa pieza contaría como usada sin que su
   * crédito cuente como cupo. Sin ciclo: solo los que quedan.
   */
  credits: Partial<Record<ContentType, number>>
  unifiedPool: number | null
  estimated: boolean
}

/**
 * Suma a los créditos restantes los consumidos por requerimientos del ciclo que cuentan en `computeTotals`
 * (no anulados, no arrastrados, con `paid_from_credit_id`). `consumeContentCreditForRequirement` consume
 * exactamente 1 unidad del crédito del `content_type` del requerimiento (`CONTENT_TYPE_TO_CREDIT_KIND`), así que
 * se devuelve 1 unidad de ese tipo, y solo si el requerimiento sigue contando ese tipo en su consumo (un override
 * a 0 lo saca de `cycleTotals`, y devolver su crédito inflaría el cupo). No muta `credits`.
 */
function creditsIncludingConsumed(
  credits: Partial<Record<ContentType, number>>,
  requirements: Requirement[],
): Partial<Record<ContentType, number>> {
  const out: Partial<Record<ContentType, number>> = { ...credits }
  for (const r of requirements) {
    if (r.voided || r.carried_over || !r.paid_from_credit_id) continue
    const kind = CONTENT_TYPE_TO_CREDIT_KIND[r.content_type]
    const type = kind ? CREDIT_KIND_TO_CONTENT_TYPE[kind] : undefined
    if (!type || !((consumptionOf(r)[type] ?? 0) > 0)) continue
    out[type] = (out[type] ?? 0) + 1
  }
  return out
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
      credits: creditsIncludingConsumed(input.credits, input.cycleRequirements),
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
  if (limit > 0 && used === limit) return 'full'
  return 'neutral'
}

function isPoolType(t: ContentType): boolean {
  return (TIPPABLE_CONTENT_TYPES as ContentType[]).includes(t)
}

/** Orden canónico de piezas: fecha de entrega, creación, id (estable entre server y cliente). */
export function compareMatrixItems(
  a: Pick<ContentMatrixItem, 'deadline' | 'created_at' | 'id'>,
  b: Pick<ContentMatrixItem, 'deadline' | 'created_at' | 'id'>,
): number {
  if (a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1
  const ta = new Date(a.created_at).getTime()
  const tb = new Date(b.created_at).getTime()
  if (ta !== tb && !Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
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
    .sort(compareMatrixItems)

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
  /**
   * Tipos que comparten presupuesto semanal (pool). Si incluye contentType, `used` los cuenta todos,
   * pero el presupuesto (`budget`) se sigue leyendo por `contentType` — asume que ese presupuesto viene
   * del fallback automático por tipo (`limitsForDistribution`, que le asigna el pool completo a cada
   * tippable). Una distribución explícita por tipo cargada por el cliente bajo un pool es aproximada.
   */
  sharedTypes?: ContentType[]
  /** Fecha actual — si se pasa, evita proponer semanas ya cerradas o una fecha ya pasada dentro del ciclo. */
  today?: DateString
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
    const weekStart = addDaysString(input.periodStart, (w - 1) * 7)
    const weekEnd = w === input.maxWeek ? input.periodEnd : addDaysString(weekStart, 6)
    if (input.today && weekEnd < input.today) continue
    const budget = input.distribution[weeks[w - 1]]?.[input.contentType] ?? 0
    if ((usedByWeek.get(w) ?? 0) < budget) { chosen = w; break }
  }

  const chosenWeekStart = addDaysString(input.periodStart, (chosen - 1) * 7)
  let candidate = addDaysString(chosenWeekStart, 2)
  if (input.today && candidate < input.today) candidate = input.today
  return candidate > input.periodEnd ? input.periodEnd : candidate
}

// ── Estados y validaciones ──────────────────────────────────────────────────

export function canTransition(from: MatrixStatus, to: MatrixStatus, ctx: { hasConvertedItems: boolean }): boolean {
  if (from === to || from === 'closed') return false
  if (to === 'closed') return true
  if (from === 'draft' && to === 'approved') return true
  if (from === 'approved' && to === 'draft') return !ctx.hasConvertedItems
  return false
}

export type ApprovalProblemReason = 'sin_titulo' | 'fecha_fuera_de_periodo'
export interface ApprovalProblem { itemId: string; reason: ApprovalProblemReason }
export const APPROVAL_PROBLEM_LABELS: Record<ApprovalProblemReason, string> = {
  sin_titulo: 'Sin título',
  fecha_fuera_de_periodo: 'Fecha fuera del período',
}

export interface PeriodRange { periodStart: DateString; periodEnd: DateString }

function inPeriod(d: DateString, p: PeriodRange): boolean {
  return d >= p.periodStart && d <= p.periodEnd
}

/**
 * Valida formato `YYYY-MM-DD` Y que la fecha exista en el calendario (rechaza '2026-02-30', 'abc', '2026-10-2').
 * `parseDate` (date-fns `parseISO`) devuelve `Invalid Date` para días fuera de rango — `formatDate` lanzaría
 * `RangeError` sobre esa fecha, así que se descarta antes de reformatear.
 */
export function isIsoDate(d: string): boolean {
  // typeof: input del navegador. Un array ['2026-10-15'] pasa el regex (se coerciona) y parseISO lanzaría.
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  const parsed = parseDate(d)
  return !Number.isNaN(parsed.getTime()) && formatDate(parsed) === d
}

export function validateForApproval(
  items: Pick<ContentMatrixItem, 'id' | 'title' | 'deadline'>[],
  period: PeriodRange,
): { ok: boolean; empty: boolean; problems: ApprovalProblem[] } {
  if (items.length === 0) return { ok: false, empty: true, problems: [] }
  const problems: ApprovalProblem[] = []
  for (const it of items) {
    if (!it.title.trim()) problems.push({ itemId: it.id, reason: 'sin_titulo' })
    else if (!inPeriod(it.deadline, period)) problems.push({ itemId: it.id, reason: 'fecha_fuera_de_periodo' })
  }
  return { ok: problems.length === 0, empty: false, problems }
}

export type ItemPatch = Partial<Pick<ContentMatrixItem,
  'content_type' | 'title' | 'topic' | 'objective' | 'copy' | 'script' | 'visual_style' | 'hashtags' | 'cta' | 'deadline' | 'needs_production'>>

export function validateItemPatch(
  patch: ItemPatch,
  ctx: PeriodRange & { topics: MatrixTopic[] },
): { ok: true } | { ok: false; error: string } {
  if (patch.content_type !== undefined && !MATRIX_CONTENT_TYPES.includes(patch.content_type)) {
    return { ok: false, error: 'Ese tipo de contenido no se planifica en la matriz.' }
  }
  if (patch.deadline !== undefined && !isIsoDate(patch.deadline)) {
    return { ok: false, error: 'Fecha inválida.' }
  }
  if (patch.deadline !== undefined && !inPeriod(patch.deadline, ctx)) {
    return { ok: false, error: `La fecha debe estar entre ${formatDeadlineDate(ctx.periodStart)} y ${formatDeadlineDate(ctx.periodEnd)}.` }
  }
  if (patch.topic != null && !ctx.topics.some((t) => t.name === patch.topic)) {
    return { ok: false, error: 'El tema no está en la lista de temas de la matriz.' }
  }
  if (patch.objective != null && !MATRIX_OBJECTIVES.includes(patch.objective)) {
    return { ok: false, error: 'Objetivo inválido.' }
  }
  return { ok: true }
}

export function shiftDeadline(deadline: DateString, from: PeriodRange, to: PeriodRange): DateString {
  const offset = Math.max(0, daysBetween(from.periodStart, deadline))
  const candidate = addDaysString(to.periodStart, offset)
  return candidate > to.periodEnd ? to.periodEnd : candidate
}

/**
 * Topes de longitud (caracteres, tras recortar espacios) de los campos de texto libre. Los usan las server
 * actions para validar y la UI como `maxLength`, así un texto nunca se escribe más largo de lo que se guarda.
 */
export const MATRIX_TEXT_LIMITS = {
  title: 200,
  notes: 5000,
  copy: 5000,
  script: 10000,
  visual_style: 2000,
  hashtags: 2000,
  cta: 2000,
} as const

export const MAX_TOPICS = 20

/** Recorta un string a lo sumo `max` code points (no UTF-16 units) — evita partir un emoji a la mitad. */
function truncateCodePoints(s: string, max: number): string {
  return Array.from(s).slice(0, max).join('')
}

/**
 * Sanitiza temas venidos de un formulario o jsonb (input no confiable): descarta entradas que no son
 * objetos, cuyo `name` no es un string, o que quedan vacías tras recortar; ignora un `note` que no sea
 * string. Trata `raw` como `unknown[]` internamente aunque la firma declare `MatrixTopic[]`; si `raw` ni
 * siquiera es un array (p. ej. `null` desde el navegador), devuelve `[]`.
 */
export function sanitizeTopics(raw: MatrixTopic[]): MatrixTopic[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: MatrixTopic[] = []
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const rawName = (entry as { name?: unknown }).name
    if (typeof rawName !== 'string') continue
    const name = truncateCodePoints(rawName.trim(), 60).trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const rawNote = (entry as { note?: unknown }).note
    const note = typeof rawNote === 'string' ? truncateCodePoints(rawNote.trim(), 200).trim() : ''
    out.push(note ? { name, note } : { name })
    if (out.length >= MAX_TOPICS) break
  }
  return out
}

// ── Tipos de resultado para server actions (viven aquí porque un archivo
//    'use server' solo debe exportar funciones async) ─────────────────────────

export type ActionErr = { ok: false; error: string }
export type ActionResult<T = object> = ({ ok: true } & T) | ActionErr

export type LinkResult =
  | { ok: true; requirementId: string }
  | { ok: false; error: string }
