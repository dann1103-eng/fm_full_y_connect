import type { AiJobStatus, ContentMatrixItem, ContentType, MatrixObjective, MatrixTopic, WeeklyDistribution } from '@/types/db'
import type { DateString } from './dates'
import type { ItemPatch, MatrixLimits, MatrixUsage } from './matrix'
import {
  MATRIX_CONTENT_TYPES,
  MATRIX_ESTIMATE_MAX_MINUTES,
  MATRIX_OBJECTIVES,
  MATRIX_TEXT_LIMITS,
  proposeDeadline,
  truncateCodePoints,
} from './matrix'
import { TIPPABLE_CONTENT_TYPES } from './plans'

/**
 * Generación de matrices con IA (bloque 3) — dominio puro.
 *
 * **Nada de lo que devuelve el modelo llega a la base sin pasar por aquí.** Los handlers escriben con el
 * admin client, así que `validateItemPatch` (que solo corre dentro de `updateItem`) NO está en este camino:
 * este archivo es el único filtro. Por eso cada función trata su entrada como `unknown` y no como el JSON
 * bien formado que promete el `input_schema` de la tool.
 */

/** Estimado por defecto cuando el modelo no devuelve un número usable: una hora de trabajo. */
export const DEFAULT_ESTIMATE_MINUTES = 60

/**
 * Tope de las instrucciones de "Regenerar". Vive en el dominio porque lo usan a la vez la caja del
 * panel lateral (contador y `maxLength`) y la server action, que lo re-valida: la UI no es validación.
 * Se cuenta con `.length` (UTF-16), igual que el resto de los topes del bloque 1.
 */
export const MATRIX_INSTRUCTIONS_MAX = 300

function isPoolType(t: ContentType): boolean {
  return (TIPPABLE_CONTENT_TYPES as ContentType[]).includes(t)
}

// ── Cuánto falta por generar ────────────────────────────────────────────────

export interface PlanCapacity {
  /**
   * Faltante por tipo, solo para los tipos de `usage.activeTypes`. **Bajo pool unificado cada tippable
   * trae el total del pool** (el reparto entre tipos lo propone la IA), así que el tope por tipo NO acota
   * el total: de eso se encarga `poolRemaining` en `sanitizeGeneratedPlan`.
   */
  missing: Partial<Record<ContentType, number>>
  /** Piezas que aún caben en el pool unificado, o `null` si el plan no usa pool. */
  poolRemaining: number | null
  /** Cuántas piezas caben en total (con pool, es `poolRemaining`). */
  total: number
}

/**
 * Cuánto falta para cubrir el cupo del período, por tipo. La entrada es siempre la de `loadMatrixEditorData`
 * (`limits` + `usage` ya calculado con `convertedInCycleIds`): rederivar la cadena a mano es la forma segura
 * de que el generador y los chips discrepen.
 *
 * Usa `credits` (efectivos), **nunca `availableCredits`**: `used` ya incluye `cycleTotals`, que incluye los
 * requerimientos cuyos créditos se gastaron; con los disponibles esos créditos se descontarían dos veces.
 */
export function missingByType(limits: MatrixLimits, usage: MatrixUsage): PlanCapacity {
  const pool = usage.pool
  const poolRemaining = pool ? Math.max(0, pool.limit + pool.credits - pool.used) : null

  const missing: Partial<Record<ContentType, number>> = {}
  let total = 0
  for (const t of usage.activeTypes) {
    if (poolRemaining !== null) {
      // Bajo pool, `historia` queda FUERA del reparto: `PlanForm` pone a cero los cinco tippables al
      // activar el pool, así que una historia nacería fuera de plan y sin semana en la distribución.
      // La regla es explícita a propósito — `activeTypes` puede incluir `historia` por sus créditos.
      missing[t] = isPoolType(t) ? poolRemaining : 0
      continue
    }
    const u = usage.byType[t]
    const m = Math.max(0, u.limit + u.credits - u.used)
    missing[t] = m
    total += m
  }
  if (poolRemaining !== null) total = poolRemaining

  return { missing, poolRemaining, total }
}

// ── El plan que propone el modelo ───────────────────────────────────────────

export interface GeneratedPiece {
  content_type: ContentType
  title: string
  /** Índice en `ctx.topics` (la lista FINAL de temas), o `null` si el modelo no acertó uno válido. */
  topicIndex: number | null
  objective: MatrixObjective | null
  needs_production: boolean
  estimated_time_minutes: number
}

export interface PlanContext {
  /** Tipos con presupuesto vivo en el plan del cliente (de `usage.activeTypes`). */
  activeTypes: ContentType[]
  /** Faltante por tipo (de `missingByType`). */
  missing: Partial<Record<ContentType, number>>
  /** Tope del total bajo pool unificado; `null` sin pool. */
  poolRemaining: number | null
  /** Lista final de temas de la matriz: el `topic_index` del modelo indexa aquí. */
  topics: MatrixTopic[]
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * Recorta a `max` code points cortando en el último espacio. Code points y no `slice`: los checks de la
 * base cuentan code points y partir un par sustituto rompería el texto (y el emoji).
 */
function truncateAtWord(s: string, max: number): string {
  if (Array.from(s).length <= max) return s
  const cut = truncateCodePoints(s, max)
  // El índice de un espacio siempre es una frontera válida de code point: cortar ahí no parte nada.
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()
}

/**
 * Convierte la salida del modelo en piezas que se pueden insertar. Descarta lo que no cuadra en vez de
 * corregirlo a ciegas: tipos que no se planifican en una matriz o que el plan no tiene vivos, títulos
 * vacíos, y todo lo que pase del cupo faltante. El objetivo inventado y el índice de tema fuera de rango
 * **no** tiran la pieza: se quedan en `null` (los dos campos son nulables y el hijo puede reponer el
 * objetivo al redactar).
 */
export function sanitizeGeneratedPlan(raw: unknown, ctx: PlanContext): GeneratedPiece[] {
  if (!Array.isArray(raw)) return []

  const taken: Partial<Record<ContentType, number>> = {}
  const out: GeneratedPiece[] = []

  for (const entry of raw as unknown[]) {
    // Bajo pool el tope por tipo vale el pool entero para los cuatro tippables: sin este corte del TOTAL,
    // 4 tipos × el pool serían 4 veces el cupo, todas marcadas "fuera de plan".
    if (ctx.poolRemaining !== null && out.length >= ctx.poolRemaining) break

    const p = asRecord(entry)
    if (!p) continue

    const type = p.content_type
    if (typeof type !== 'string') continue
    const contentType = type as ContentType
    if (!MATRIX_CONTENT_TYPES.includes(contentType)) continue
    if (!ctx.activeTypes.includes(contentType)) continue

    const cap = ctx.missing[contentType] ?? 0
    if ((taken[contentType] ?? 0) >= cap) continue

    if (typeof p.title !== 'string') continue
    const title = truncateAtWord(p.title.trim(), MATRIX_TEXT_LIMITS.title).trim()
    if (!title) continue

    const objective = typeof p.objective === 'string' && (MATRIX_OBJECTIVES as string[]).includes(p.objective)
      ? (p.objective as MatrixObjective)
      : null

    const idx = p.topic_index
    const topicIndex = typeof idx === 'number' && Number.isInteger(idx) && idx >= 0 && idx < ctx.topics.length
      ? idx
      : null

    const rawMinutes = p.estimated_time_minutes
    const estimated = typeof rawMinutes === 'number' && Number.isFinite(rawMinutes)
      ? Math.min(MATRIX_ESTIMATE_MAX_MINUTES, Math.max(1, Math.round(rawMinutes)))
      : DEFAULT_ESTIMATE_MINUTES

    taken[contentType] = (taken[contentType] ?? 0) + 1
    out.push({
      content_type: contentType,
      title,
      topicIndex,
      objective,
      needs_production: p.needs_production === true,
      estimated_time_minutes: estimated,
    })
  }

  return out
}

// ── El brief que escribe el hijo ────────────────────────────────────────────

/**
 * Los ÚNICOS campos que el hijo puede escribir. Fuera de esta lista quedan a propósito los cinco que el
 * bloque 2 congela al convertir (`title`, `content_type`, `deadline`, `assigned_to`,
 * `estimated_time_minutes`) y todo lo que es del sistema (`id`, `status`, `requirement_id`, …): el
 * handler escribe con el admin client y nada más lo detendría.
 */
const BRIEF_TEXT_FIELDS = ['copy', 'script', 'visual_style', 'hashtags', 'cta'] as const

/**
 * Recorta y filtra el brief que devuelve el modelo. Un campo ausente o que no es string se **omite** (no
 * se toca lo que ya había, ni se escribe la cadena "undefined"); un campo vacío sí se escribe como `null`,
 * que es como el resto del editor guarda "sin texto" — regenerar puede querer limpiar un CTA.
 */
export function sanitizeGeneratedBrief(raw: unknown): Partial<ItemPatch> {
  const p = asRecord(raw)
  if (!p) return {}

  const out: Partial<ItemPatch> = {}
  for (const f of BRIEF_TEXT_FIELDS) {
    const v = p[f]
    if (typeof v !== 'string') continue
    const trimmed = truncateAtWord(v.trim(), MATRIX_TEXT_LIMITS[f]).trim()
    out[f] = trimmed ? trimmed : null
  }
  if (typeof p.objective === 'string' && (MATRIX_OBJECTIVES as string[]).includes(p.objective)) {
    out.objective = p.objective as MatrixObjective
  }
  if (typeof p.needs_production === 'boolean') out.needs_production = p.needs_production
  return out
}

/**
 * Qué hace el hijo con la respuesta del modelo:
 *
 * - `truncada` — `stop_reason: 'max_tokens'`. **Gana aunque el brief traiga campos**: lo que llegó es un
 *   brief a medias (el último campo cortado, los siguientes ausentes) y escribirlo pondría `ai_written_at`,
 *   con lo que la invariante (b) del padre ya no volvería a encolar esa pieza. Tampoco se lanza: reintentar
 *   el mismo prompt da el mismo corte y cobra dos veces más (Parte 5 del spec). La pieza queda sin redactar
 *   y se recupera con "Regenerar".
 * - `vacia` — sin truncar y sin ningún campo usable: sí vale la pena el reintento del runner.
 * - `escribir` — el caso normal.
 */
export type BriefOutcome = 'truncada' | 'vacia' | 'escribir'

export function briefOutcome(stopReason: string | null, patchFieldCount: number): BriefOutcome {
  if (stopReason === 'max_tokens') return 'truncada'
  return patchFieldCount === 0 ? 'vacia' : 'escribir'
}

// ── Fechas de entrega ───────────────────────────────────────────────────────

export interface DeadlineContext {
  /** Piezas que YA están en la matriz: son la semilla del presupuesto semanal. */
  existingItems: Pick<ContentMatrixItem, 'content_type' | 'deadline'>[]
  distribution: WeeklyDistribution
  periodStart: DateString
  periodEnd: DateString
  maxWeek: 4 | 8
  /** Tipos que comparten presupuesto semanal (`sharedTypesFor(limits)`): sin esto, bajo pool los 12 tippables caen en la semana 1. */
  sharedTypes?: ContentType[]
  /** Hoy: sin esto se proponen fechas pasadas que el barrido del bloque 2 convertiría a la mañana siguiente. */
  today: DateString
}

export type PlannedPiece = GeneratedPiece & { deadline: DateString }

/**
 * Pone fecha a cada pieza generada. Envuelve a `proposeDeadline` acumulando las piezas ya propuestas en la
 * misma corrida **sobre las que la matriz ya tenía**: el presupuesto semanal se consume de verdad y las
 * piezas no se amontonan todas en la primera semana con hueco.
 */
export function assignDeadlines(plan: readonly GeneratedPiece[], ctx: DeadlineContext): PlannedPiece[] {
  const seen: Pick<ContentMatrixItem, 'content_type' | 'deadline'>[] = ctx.existingItems.map((i) => ({
    content_type: i.content_type, deadline: i.deadline,
  }))
  const out: PlannedPiece[] = []
  for (const p of plan) {
    const deadline = proposeDeadline({
      contentType: p.content_type,
      items: seen,
      distribution: ctx.distribution,
      periodStart: ctx.periodStart,
      periodEnd: ctx.periodEnd,
      maxWeek: ctx.maxWeek,
      sharedTypes: ctx.sharedTypes,
      today: ctx.today,
    })
    seen.push({ content_type: p.content_type, deadline })
    out.push({ ...p, deadline })
  }
  return out
}

// ── La invariante (b) del padre ─────────────────────────────────────────────

export interface ChildWorkItem {
  id: string
  ai_written_at: string | null
  copy: string | null
}

export interface ChildWorkJob {
  content_matrix_item_id: string | null
  status: AiJobStatus
}

/**
 * Qué piezas necesitan un hijo `matrix_item_write`. Es la invariante (b) del padre —"toda pieza sin
 * redactar tiene un hijo"— y lo que hace inofensivo al watchdog de 0124: si al padre lo mataron entre el
 * insert de las piezas y el encolado de los hijos, el reintento encola lo que falte y termina sin llamar
 * al modelo.
 *
 * **Cualquier job previo de esa pieza cuenta, no solo uno vivo.** Un hijo `failed` NO se reintenta solo
 * (Parte 5 del spec: insistir con un prompt que falló da el mismo resultado y quema tokens); la salida es
 * el botón "Regenerar". `jobs` debe traer los `matrix_item_write` de la matriz sin filtrar por estado.
 */
export function pendingChildWork(items: readonly ChildWorkItem[], jobs: readonly ChildWorkJob[]): string[] {
  const withJob = new Set<string>()
  for (const j of jobs) if (j.content_matrix_item_id) withJob.add(j.content_matrix_item_id)

  return items
    .filter((i) => isUnwritten(i) && !withJob.has(i.id))
    .map((i) => i.id)
}

/** Sin redactar: ni la IA la escribió ni tiene copy (uno de solo espacios cuenta como vacío). */
function isUnwritten(i: ChildWorkItem): boolean {
  return !i.ai_written_at && !(i.copy ?? '').trim()
}

// ── La compuerta de "Generar con IA" ────────────────────────────────────────

const LIVE_JOB_STATUSES: readonly AiJobStatus[] = ['pending', 'processing']

export const MATRIX_QUOTA_COVERED = 'La matriz ya cubre el cupo del plan.'

export type GenerationGate = { ok: true } | { ok: false; error: string }

/**
 * Si "Generar con IA" tiene algo que hacer: falta cupo **o** queda alguna pieza sin redactar que el padre
 * encolaría (su invariante (b)). La segunda vía es la de una matriz llenada a mano con piezas sin brief:
 * sin ella, "Generar con IA" nunca las redactaría.
 *
 * Usa `pendingChildWork` tal cual —cualquier job previo de la pieza cuenta, no solo uno vivo— para
 * aceptar exactamente lo que el padre va a hacer: con un criterio más laxo la acción encolaría un padre
 * que terminaría `cupo_cubierto` sin tocar nada. `jobs` son los `matrix_item_write` de la matriz sin
 * filtrar por estado; con cupo faltante no se miran, así que pueden venir vacíos.
 *
 * El rechazo dice por qué: todo redactado, lo pendiente ya en cola, o lo pendiente terminó sin texto
 * (fallido o truncado) y solo sale con "Regenerar", porque el padre no lo reintenta solo.
 */
export function generationGate(
  missingTotal: number,
  items: readonly ChildWorkItem[],
  jobs: readonly ChildWorkJob[],
): GenerationGate {
  if (missingTotal > 0 || pendingChildWork(items, jobs).length > 0) return { ok: true }

  const unwritten = new Set(items.filter(isUnwritten).map((i) => i.id))
  if (unwritten.size === 0) {
    // Sin piezas no hay nada que decir de su redacción.
    return {
      ok: false,
      error: items.length > 0 ? 'La matriz ya cubre el cupo del plan y todas sus piezas están redactadas.' : MATRIX_QUOTA_COVERED,
    }
  }

  const queued = new Set<string>()
  for (const j of jobs) {
    if (j.content_matrix_item_id && unwritten.has(j.content_matrix_item_id) && LIVE_JOB_STATUSES.includes(j.status)) {
      queued.add(j.content_matrix_item_id)
    }
  }
  return {
    ok: false,
    error: queued.size === unwritten.size
      ? 'La matriz ya cubre el cupo del plan y sus piezas sin redactar ya están en cola.'
      : 'La matriz ya cubre el cupo del plan. Las piezas que quedaron sin redactar se rehacen con "Regenerar".',
  }
}
