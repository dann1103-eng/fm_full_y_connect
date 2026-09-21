import type { AiJobStatus, ContentMatrixItem, MatrixTopic } from '@/types/db'
import { generationGate, isUnwritten, type ChildWorkItem, type UnwrittenCheckItem } from './matrix-ai'

/**
 * Progreso de la generación con IA en el editor abierto (bloque 3) — dominio puro.
 *
 * Aquí vive todo lo que decide qué hace el editor con cada respuesta del sondeo a
 * `GET /api/matrices/[id]/generation`: la forma de la respuesta, cuándo sigue viva la generación y,
 * sobre todo, **cómo se fusionan las filas del servidor sin pisar lo que el usuario está escribiendo**.
 * Separado de `matrix-ai.ts` (lo que corre en los handlers) porque esto corre en el navegador.
 */

// ── La respuesta de la ruta ─────────────────────────────────────────────────

export type GenerationPhase = 'planning' | 'writing' | 'idle' | 'failed'

/** El último hijo `matrix_item_write` de una pieza. */
export interface ItemJobState { itemId: string; status: AiJobStatus }

/** Pieza cuyo último hijo no dejó texto: `reason` si terminó `skipped` (slug), `error` si falló. */
export interface FailedItem { itemId: string; reason: string | null; error: string | null }

export interface GenerationProgress {
  /**
   * Del padre MÁS RECIENTE (`matrix_generate`), salvo `writing`, que también cubre una regeneración
   * suelta. **No es la señal de vida**: tras un padre fallido, un "Regenerar" corre con
   * `phase: 'failed'` y la franja roja arriba. La señal es `isGenerationLive`.
   */
  phase: GenerationPhase
  /** Hijos de ese padre. Puede venir `writing` con `total: 0` (regeneración sin padre). */
  total: number
  /** Hijos de ese padre que escribieron el brief. */
  done: number
  /** Hijos de ese padre que no dejaron texto: `failed`, o `completed` sin escribir (`respuesta_truncada`). */
  failed: number
  /** Piezas con un hijo vivo, incluidas las regeneraciones sueltas. */
  writingItemIds: string[]
  /**
   * El último hijo de cada pieza que tuvo alguno. Es la entrada de `generationGate` (`matrix-ai.ts`): el
   * botón "Generar con IA" la llama con esto y así decide con la MISMA función que `generateMatrix`.
   */
  itemJobs: ItemJobState[]
  /** Piezas cuyo último hijo no dejó texto, con el motivo. */
  failedItems: FailedItem[]
  error: string | null
  /** Motivo del `result_json` del padre (`sin_plan_valido`, `cupo_cubierto`, …): ver `generationReasonLabel`. */
  reason: string | null
  /** `topics_json` actual de la matriz, completo en cada respuesta. */
  topics: MatrixTopic[] | null
  /** `updated_at` de la matriz leída: sin él, una respuesta vieja no se distingue de una nueva y revertiría los temas. */
  matrixUpdatedAt: string | null
  /** Solo las filas con `updated_at > since`, ascendentes. */
  items: ContentMatrixItem[]
  /**
   * Marca de agua para el sondeo siguiente. Se devuelve TAL CUAL como `since`: el padre inserta todas
   * las piezas en una sola sentencia (comparten `updated_at`) y un `since` derivado del reloj del
   * navegador perdería el lote entero por desfase.
   */
  watermark: string | null
}

/**
 * ¿Hay que seguir sondeando? Planificando (el padre vivo todavía no creó piezas, así que no hay hijos
 * que mirar) o con algún hijo vivo. `phase` sola no sirve: un "Regenerar" después de un padre fallido
 * corre con `phase: 'failed'`, y `phase: 'writing'` puede venir con `total: 0`.
 */
export function isGenerationLive(p: Pick<GenerationProgress, 'phase' | 'writingItemIds'>): boolean {
  return p.phase === 'planning' || p.writingItemIds.length > 0
}

/**
 * "Sin redactar" (Parte 4 del spec): ni la IA la escribió ni tiene nada en el brief. **Es `isUnwritten`
 * de `matrix-ai.ts`, no una copia**: la regla vive en un solo sitio. Aquí solo decide qué muestra la fila,
 * nunca si se puede generar (eso es `generationGate`).
 */
export function isUnwrittenItem(item: UnwrittenCheckItem): boolean {
  return isUnwritten(item)
}

// ── Mensajes ────────────────────────────────────────────────────────────────

/**
 * Motivos con que un job de matriz termina sin hacer (todo) el trabajo: del padre (`result_json.reason`
 * o `skipped`) y del hijo (`skipped`). Lista cerrada con respaldo: un motivo que nadie mapeó cae en
 * `GENERATION_REASON_FALLBACK`, **nunca** en el slug crudo.
 */
export const GENERATION_REASON_LABELS: Readonly<Record<string, string>> = {
  sin_plan_valido: 'La IA no devolvió ninguna pieza válida. Intenta de nuevo.',
  cupo_cubierto: 'La matriz ya cubre el cupo del plan.',
  hijos_reencolados: 'Se retomó la redacción de las piezas que habían quedado pendientes.',
  matriz_no_borrador: 'La matriz dejó de estar en borrador, así que no se generó nada.',
  sin_perfil_de_marca: 'Este cliente no tiene perfil de marca.',
  sin_tipos_activos: 'El plan del cliente no tiene tipos de contenido con cupo para generar.',
  matriz_no_encontrada: 'No se encontró la matriz.',
  matriz_no_existe: 'No se encontró la matriz.',
  pieza_no_existe: 'La pieza ya no existe.',
  matriz_cerrada: 'La matriz está cerrada.',
  cliente_no_existe: 'No se encontró el cliente.',
  respuesta_truncada: 'La respuesta de la IA se cortó. Prueba «Regenerar» con instrucciones más breves.',
}

export const GENERATION_REASON_FALLBACK = 'La generación terminó sin completar el trabajo.'

export function generationReasonLabel(reason: string): string {
  // `hasOwnProperty` y no un indexado a secas: `'constructor'` o `'toString'` devolverían una función.
  return Object.prototype.hasOwnProperty.call(GENERATION_REASON_LABELS, reason)
    ? GENERATION_REASON_LABELS[reason]
    : GENERATION_REASON_FALLBACK
}

/** Lo que muestra una pieza cuyo último hijo no dejó texto. */
export function failedItemLabel(f: Pick<FailedItem, 'reason'>): string {
  return f.reason ? generationReasonLabel(f.reason) : 'La IA no pudo redactar esta pieza.'
}

// ── El botón "Generar con IA" ───────────────────────────────────────────────

export const GENERATE_BLOCK_REASONS = {
  brandUnknown: 'No se pudo comprobar el perfil de marca del cliente.',
  noBrand: 'Este cliente no tiene perfil de marca.',
  checking: 'Comprobando el estado de la generación…',
  /** El mismo texto que devuelve `generateMatrix` ante el 23505 del índice de un padre vivo. */
  running: 'Ya hay una generación en curso para esta matriz.',
} as const

/**
 * Por qué "Generar con IA" está deshabilitado, o `null` si se puede. Recorre **en el mismo orden** lo que
 * valida `generateMatrix` (la matriz en borrador la pone quien muestra el botón): perfil de marca usable
 * → `generationGate` → el índice único de un padre vivo. La compuerta es **la misma función** que usa la
 * acción (`generationGate` de `matrix-ai.ts`), alimentada con el último hijo de cada pieza que devuelve la
 * ruta de progreso: una copia de la regla acabaría divergiendo — un hijo truncado termina `completed` sin
 * escribir y la acción lo da por atendido, así que el botón no puede ofrecer lo que la acción rechazaría.
 *
 * Los datos sí pueden estar un poco viejos (el cupo es el del render del servidor, como los chips): la
 * acción re-evalúa todo con datos frescos.
 */
export function generateBlockReason(a: {
  /** `null`: no se pudo leer el perfil (p. ej. sin la migración 0131). */
  brandReady: boolean | null
  missingTotal: number
  items: readonly ChildWorkItem[]
  /** El último hijo de cada pieza, de la ruta de progreso; `null` antes de la primera respuesta. */
  itemJobs: readonly ItemJobState[] | null
  /** El padre más reciente está vivo (`phase: 'planning'`). */
  parentLive: boolean
}): string | null {
  if (a.brandReady === null) return GENERATE_BLOCK_REASONS.brandUnknown
  if (!a.brandReady) return GENERATE_BLOCK_REASONS.noBrand
  // Con cupo faltante la compuerta abre sin mirar los hijos; sin él, decidir sin conocerlos sería adivinar.
  if (a.missingTotal <= 0 && a.itemJobs === null) return GENERATE_BLOCK_REASONS.checking
  const jobs = (a.itemJobs ?? []).map((j) => ({ content_matrix_item_id: j.itemId, status: j.status }))
  const gate = generationGate(a.missingTotal, a.items, jobs)
  if (!gate.ok) return gate.error
  if (a.parentLive) return GENERATE_BLOCK_REASONS.running
  return null
}

// ── Marcas de tiempo ────────────────────────────────────────────────────────

/**
 * `timestamptz` de PostgREST → microsegundos desde epoch, o `null` si es ilegible. `Date.parse` se
 * queda en milisegundos y Postgres guarda microsegundos: dos escrituras dentro del mismo milisegundo
 * serían "iguales" y una respuesta vieja pasaría por nueva.
 */
export function timestampMicros(ts: string): number | null {
  const ms = Date.parse(ts)
  if (Number.isNaN(ms)) return null
  // La fracción va justo después de los segundos (`:SS.ffffff`); Postgres recorta los ceros finales.
  const frac = /:\d{2}\.(\d+)/.exec(ts)
  const micros = frac ? Number(`${frac[1]}000000`.slice(0, 6)) : 0
  return Math.floor(ms / 1000) * 1_000_000 + micros
}

/** Negativo si `a` es anterior a `b`, 0 si son iguales, positivo si es posterior. Ilegible = el más viejo. */
export function compareTimestamps(a: string, b: string): number {
  const x = timestampMicros(a)
  const y = timestampMicros(b)
  if (x === null || y === null) return x === y ? 0 : x === null ? -1 : 1
  return x - y
}

/** El `updated_at` más reciente: siembra la primera marca de agua con las filas del render del servidor. */
export function maxUpdatedAt(rows: readonly { updated_at: string }[]): string | null {
  let max: string | null = null
  for (const r of rows) if (max === null || compareTimestamps(r.updated_at, max) > 0) max = r.updated_at
  return max
}

// ── La fusión ───────────────────────────────────────────────────────────────

/**
 * Qué campos de una pieza no puede tocar una respuesta del sondeo. Son dos candados distintos:
 *
 * - `stale`: lo local de ese campo cambió **después de enviarse la consulta** (empezó o terminó un
 *   guardado, una conversión, un cambio de temas). El valor que trae la respuesta puede ser anterior a
 *   lo que ya se sabe, así que no se usa **ni en pantalla ni en la fila confirmada**. El siguiente
 *   sondeo, enviado después, lo trae bien.
 * - `screen`: hay un guardado **en vuelo** o un **borrador fallido**. La pantalla no se toca (revertiría
 *   lo recién escrito: `MatrixItemSheet.commitText` suelta el borrador local antes de que llegue la
 *   respuesta), pero la fila confirmada sí: es el destino del rollback si ese guardado falla, y tiene
 *   que ser lo último que hay en la base.
 */
export interface FieldLocks {
  stale: (key: keyof ContentMatrixItem) => boolean
  screen: (key: keyof ContentMatrixItem) => boolean
}

export interface ItemMerge {
  id: string
  /** La nueva fila confirmada (va a `confirmedItems`). Si la pieza no estaba en pantalla, es la que se agrega. */
  confirmed: ContentMatrixItem
  /** Campos a aplicar sobre la pieza en pantalla. */
  screen: Partial<ContentMatrixItem>
}

const IMMUTABLE_KEYS: ReadonlySet<string> = new Set(['id', 'matrix_id', 'created_at', 'updated_at'])

/**
 * Fusiona una fila del sondeo con la última confirmada de esa pieza.
 *
 * **Nunca retrocede**: si la fila del sondeo es más vieja que la confirmada (la consulta leyó antes de
 * que terminara un guardado cuya respuesta ya llegó), la fuente es la confirmada. Eso además muestra
 * lo que la confirmada sabía y la pantalla no — un guardado de `copy` devuelve la fila entera, con el
 * guion que la IA escribió entretanto, pero el editor solo aplica `copy`.
 */
export function mergePolledItem(
  polled: ContentMatrixItem,
  confirmed: ContentMatrixItem | undefined,
  locks: FieldLocks,
): ItemMerge {
  // Pieza desconocida: la agregó otro (el padre), así que no puede tener nada local en vuelo.
  if (!confirmed) return { id: polled.id, confirmed: polled, screen: { ...polled } }

  const older = compareTimestamps(polled.updated_at, confirmed.updated_at) < 0
  const source = older ? confirmed : polled
  const next: ContentMatrixItem = { ...confirmed }
  const screen: Partial<ContentMatrixItem> = {}
  const nextRecord = next as unknown as Record<string, unknown>
  const screenRecord = screen as Record<string, unknown>
  const sourceRecord = source as unknown as Record<string, unknown>

  for (const key of Object.keys(polled) as (keyof ContentMatrixItem)[]) {
    if (IMMUTABLE_KEYS.has(key) || locks.stale(key)) continue
    nextRecord[key] = sourceRecord[key]
    if (!locks.screen(key)) screenRecord[key] = sourceRecord[key]
  }
  next.updated_at = source.updated_at
  screen.updated_at = source.updated_at
  return { id: polled.id, confirmed: next, screen }
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i])
  return false
}

/**
 * Aplica las fusiones sobre la lista en pantalla: la pieza conocida recibe sus campos libres, la
 * desconocida se agrega entera. Pura (va dentro de un `setItems` funcional, que StrictMode invoca dos
 * veces) y devuelve **la misma lista** si nada cambió, para que un sondeo sin novedades no re-renderice.
 *
 * Las lápidas (piezas borradas en este editor) las filtra quien llama, ANTES: una pieza borrada no debe
 * ni entrar a `confirmedItems`.
 */
export function applyItemMerges(list: ContentMatrixItem[], merges: readonly ItemMerge[]): ContentMatrixItem[] {
  if (merges.length === 0) return list
  const byId = new Map(merges.map((m) => [m.id, m]))
  const seen = new Set<string>()
  let changed = false
  const next = list.map((item) => {
    const m = byId.get(item.id)
    if (!m) return item
    seen.add(item.id)
    const keys = Object.keys(m.screen) as (keyof ContentMatrixItem)[]
    if (keys.every((k) => sameValue(item[k], m.screen[k]))) return item
    changed = true
    return { ...item, ...m.screen }
  })
  for (const m of merges) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    next.push(m.confirmed)
    changed = true
  }
  return changed ? next : list
}

/**
 * La más nueva de dos versiones de la misma pieza (empate: la primera). Para agregar una pieza que el
 * sondeo pudo haber traído antes que la respuesta de `addItem`/`duplicateItem`.
 */
export function newestItem(a: ContentMatrixItem, b: ContentMatrixItem | undefined): ContentMatrixItem {
  return b && compareTimestamps(b.updated_at, a.updated_at) > 0 ? b : a
}

/**
 * Temas de la respuesta frente a los confirmados. Mismo principio que las piezas: si la matriz leída es
 * más vieja que la confirmada, mandan los confirmados. Sin esto, un sondeo que leyó antes de que el
 * padre escribiera los temas —y llegó después de un guardado del título, que ya los trajo— devolvería
 * la lista vacía, y el siguiente cambio de temas borraría en el servidor los de la IA junto con el tema
 * de cada pieza generada.
 */
export function mergePolledTopics(
  polled: { topics: MatrixTopic[] | null; matrixUpdatedAt: string | null },
  confirmed: { topics_json: MatrixTopic[]; updated_at: string },
): { topics: MatrixTopic[]; updatedAt: string } | null {
  if (!polled.topics || !polled.matrixUpdatedAt) return null
  if (compareTimestamps(polled.matrixUpdatedAt, confirmed.updated_at) < 0) {
    return { topics: confirmed.topics_json, updatedAt: confirmed.updated_at }
  }
  return { topics: polled.topics, updatedAt: polled.matrixUpdatedAt }
}

/** Misma lista de temas (nombre y nota, en orden): evita re-renderizar la barra en cada sondeo. */
export function sameTopics(a: readonly MatrixTopic[], b: readonly MatrixTopic[]): boolean {
  return a.length === b.length && a.every((t, i) => t.name === b[i].name && (t.note ?? null) === (b[i].note ?? null))
}
