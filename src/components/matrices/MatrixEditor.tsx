'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ContentMatrix, ContentMatrixItem, ContentType, MatrixStatus, MatrixTopic } from '@/types/db'
import type { MatrixEditorData } from '@/lib/data/matrices'
import {
  compareMatrixItems, computeMatrixUsage, validateForApproval, CONVERT_REASON_NOT_APPROVED,
  type ActionErr, type ItemPatch, type TargetPeriod,
} from '@/lib/domain/matrix'
import {
  addItem, convertItemNow, deleteItem, deleteMatrix, duplicateItem, duplicateMatrix, replanItem,
  retryMatrixRequirementLink, setMatrixStatus, updateItem, updateMatrix,
} from '@/app/actions/matrices'
import { generateMatrix, regenerateItem } from '@/app/actions/matrixAi'
import { missingByType } from '@/lib/domain/matrix-ai'
import { MatrixHeader, type SaveState } from './MatrixHeader'
import { MatrixTopicsBar } from './MatrixTopicsBar'
import { MatrixItemsTable } from './MatrixItemsTable'
import { ITEM_TEXT_KEYS, MatrixItemSheet, type FailedItemDrafts, type ItemTextKey } from './MatrixItemSheet'
import { DuplicateMatrixDialog } from './DuplicateMatrixDialog'
import { MatrixGenerationStrip } from './MatrixGenerationStrip'
import { forgetLinkError, readLinkError, rememberLinkError } from './matrixLinkError'
import { useMatrixGeneration } from '@/hooks/useMatrixGeneration'
import {
  applyItemMerges, GENERATE_BLOCK_REASONS, generateBlockReason, isUnwrittenItem, maxUpdatedAt, mergePolledItem,
  mergePolledTopics, newestItem, sameTopics, type GenerationProgress, type ItemMerge,
} from '@/lib/domain/matrix-generation'

type MatrixPatch = Parameters<typeof updateMatrix>[1]
type MatrixTextKey = 'title' | 'notes'
type FailedMatrixDrafts = Partial<Record<MatrixTextKey, string>>

/** Error visible. `fields`: llaves de los campos si vino de un guardado por campo; vacío si de una acción. */
interface EditorError { message: string; fields: string[] }

type PatchResult = 'saved' | 'failed' | 'superseded'

const UNEXPECTED_ERROR = 'No se pudo completar la acción. Revisa tu conexión e intenta de nuevo.'
const STATUS_FIELDS: readonly (keyof ContentMatrix)[] = ['status', 'approved_by', 'approved_at', 'closed_at', 'updated_at']
/** Campos que cambian "Convertir ahora" y "Volver a planificar" (la primera no devuelve la fila). */
const CONVERSION_FIELDS: readonly (keyof ContentMatrixItem)[] = ['status', 'requirement_id', 'blocked_reason', 'blocked_at', 'converted_at']
/** Llave del guardado de temas: quitar un tema suelta en el servidor el `topic` de sus piezas. */
const TOPICS_FIELD = 'matrix:topics_json'

/** Copia de `src` solo con las llaves indicadas. */
function pickKeys<T extends object>(src: T, keys: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {}
  for (const k of keys) out[k] = src[k]
  return out
}

function isItemTextKey(k: string): k is ItemTextKey {
  return (ITEM_TEXT_KEYS as readonly string[]).includes(k)
}

function withoutMatrixDrafts(drafts: FailedMatrixDrafts, keys: readonly MatrixTextKey[]): FailedMatrixDrafts {
  if (!keys.some((k) => drafts[k] !== undefined)) return drafts
  return Object.fromEntries(Object.entries(drafts).filter(([k]) => !(keys as readonly string[]).includes(k))) as FailedMatrixDrafts
}

function withoutItemDrafts(all: Record<string, FailedItemDrafts>, itemId: string, keys: readonly ItemTextKey[]) {
  const current = all[itemId]
  if (!current || !keys.some((k) => current[k] !== undefined)) return all
  const rest = Object.fromEntries(Object.entries(current).filter(([k]) => !(keys as readonly string[]).includes(k))) as FailedItemDrafts
  const next = { ...all }
  if (Object.keys(rest).length > 0) next[itemId] = rest
  else delete next[itemId]
  return next
}

/**
 * Estado local de matriz y piezas, inicializado desde props y nunca resincronizado con `router.refresh()`:
 * cada acción devuelve la fila y se aplica aquí. Uso, fuera de plan y problemas de aprobación se derivan en
 * cliente con las funciones puras del dominio.
 *
 * Guardado por campo: optimista sobre `matrix`/`items`, con rollback a la última versión CONFIRMADA por el
 * servidor (refs `confirmed*`, no el estado optimista) y sin perder el texto: si un guardado de texto falla,
 * lo escrito queda en `failed*Drafts` y los campos lo siguen mostrando hasta que un guardado posterior salga bien.
 *
 * `brandReady`: el cliente tiene perfil de marca usable (`hasUsableBrandProfile`, calculado en el servidor);
 * `null` si no se pudo leer. Es la compuerta de la generación con IA.
 */
export function MatrixEditor({ data, brandReady }: { data: MatrixEditorData; brandReady: boolean | null }) {
  const router = useRouter()
  const matrixId = data.matrix.id
  const [matrix, setMatrix] = useState<ContentMatrix>(data.matrix)
  const [items, setItems] = useState<ContentMatrixItem[]>(data.items)
  const [linked, setLinked] = useState(data.linkedRequirement)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [saving, setSaving] = useState(0)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<EditorError | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showProblems, setShowProblems] = useState(false)
  // Piezas convertidas cuyo requerimiento está anulado: sale del loader y se actualiza al replanificar.
  const [voidedItemIds, setVoidedItemIds] = useState<string[]>(data.linkedVoidedItemIds)
  // Pieza con "Convertir ahora" o "Volver a planificar" en curso: evita el doble clic.
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [dupOpen, setDupOpen] = useState(false)
  const [failedItemDrafts, setFailedItemDrafts] = useState<Record<string, FailedItemDrafts>>({})
  const [failedMatrixDrafts, setFailedMatrixDrafts] = useState<FailedMatrixDrafts>({})
  // Generación con IA: encolando el padre, franja ocultada, "Regenerar" encolándose y piezas regeneradas aquí
  // (solo de esas se señala un fallo aunque tengan texto: el "Redactando…" no puede apagarse en silencio).
  const [generating, setGenerating] = useState(false)
  const [stripDismissed, setStripDismissed] = useState(false)
  const [regeneratingIds, setRegeneratingIds] = useState<string[]>([])
  const [regeneratedHere, setRegeneratedHere] = useState<string[]>([])

  // Últimas filas confirmadas por el servidor: se actualizan con cada respuesta exitosa y al agregar/duplicar.
  const confirmedMatrix = useRef<ContentMatrix>(data.matrix)
  const confirmedItems = useRef(new Map<string, ContentMatrixItem>(data.items.map((i) => [i.id, i])))
  // Secuencia por campo ("matrix:title", "item:<id>:copy"): solo el guardado más reciente de un campo puede
  // aplicar su respuesta o revertirlo.
  const saveSeq = useRef(0)
  const latestSeqByField = useRef(new Map<string, number>())

  // ── Sondeo de la generación con IA (bloque 3): lo que la fusión necesita saber ──
  // Guardados EN VUELO por campo: +1 al empezar, -1 al terminar. `latestSeqByField` no sirve para esto:
  // guarda la última secuencia INICIADA y nunca se limpia, así que no sabe qué sigue en vuelo.
  const inFlightByField = useRef(new Map<string, number>())
  // Último cambio local de cada campo (al empezar y al terminar cada guardado, conversión o cambio de
  // temas). Una respuesta del sondeo enviada ANTES de ese cambio no puede tocar el campo.
  const localSeq = useRef(0)
  const lastLocalChange = useRef(new Map<string, number>())
  // Lápidas: piezas borradas en este editor. Un sondeo enviado antes del borrado no las resucita.
  const deletedItemIds = useRef(new Set<string>())
  // Espejo de `failedItemDrafts` para la fusión, que corre fuera del render.
  const failedItemDraftsRef = useRef(failedItemDrafts)
  useEffect(() => { failedItemDraftsRef.current = failedItemDrafts }, [failedItemDrafts])
  // Primera marca de agua: el `updated_at` más reciente de las filas del servidor. Sin ella la primera
  // consulta traería la matriz entera (~150 kB con guiones largos).
  const [initialSince] = useState(() => maxUpdatedAt(data.items))

  // Motivo real del vínculo fallido al crear o duplicar (lo guardó quien navegó hasta aquí). Se lee después
  // de montar y no en un inicializador de useState: el servidor no tiene sessionStorage, así que leerlo en
  // el render haría que la franja del HTML del servidor (sin motivo) y la de la hidratación no coincidieran.
  // El setState va en un microtask (patrón del repo, ver TopNav) y la llave se borra ahí mismo, no antes:
  // con StrictMode el efecto corre dos veces y la primera ejecución se cancela sin consumir la llave.
  useEffect(() => {
    const stored = readLinkError(matrixId)
    if (stored === null) return
    let cancelled = false
    Promise.resolve().then(() => {
      if (cancelled) return
      forgetLinkError(matrixId)
      setLinkError((current) => current ?? stored)
    })
    return () => { cancelled = true }
  }, [matrixId])

  // `convertedInCycleIds` es imprescindible: sin él toda pieza `converted` se descontaría de los chips
  // (el servidor la cuenta vía `cycleTotals`, el cliente no) y el chip del servidor y el del cliente
  // divergirían en cuanto se editara cualquier cosa.
  const usage = useMemo(
    () => computeMatrixUsage(items, data.limits, data.convertedInCycleIds),
    [items, data.limits, data.convertedInCycleIds],
  )
  const sortedItems = useMemo(() => [...items].sort(compareMatrixItems), [items])
  const plannedCount = useMemo(() => items.filter((i) => i.status === 'planned').length, [items])
  const blockedCount = useMemo(() => items.filter((i) => i.status === 'blocked').length, [items])
  // Tras un intento fallido de aprobar, los problemas se recalculan en vivo: se apagan al corregir cada pieza.
  const problems = useMemo(
    () => (showProblems ? validateForApproval(items, data.period).problems : []),
    [showProblems, items, data.period],
  )
  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId])
  const readOnly = matrix.status === 'closed'
  // "Sin guardar" se deriva de los textos fallidos que siguen pendientes, no del resultado del último guardado:
  // un guardado exitoso de otro campo no debe esconder que hay texto sin guardar.
  const unsavedItemIds = useMemo(() => Object.keys(failedItemDrafts), [failedItemDrafts])
  const unsavedCount = useMemo(
    () => Object.values(failedItemDrafts).reduce((n, d) => n + Object.keys(d).length, 0) + Object.keys(failedMatrixDrafts).length,
    [failedItemDrafts, failedMatrixDrafts],
  )
  const hasUnsaved = unsavedCount > 0
  const hasUnsavedMatrixText = Object.keys(failedMatrixDrafts).length > 0
  const saveState: SaveState = saving > 0 ? 'saving' : hasUnsaved ? 'unsaved' : 'saved'

  // Recargar o cerrar la pestaña con texto sin guardar: aviso genérico del navegador.
  useEffect(() => {
    if (!hasUnsaved) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = '' // navegadores que aún no respetan preventDefault
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [hasUnsaved])

  // ── Infraestructura de llamadas ──

  /** Llama una server action con indicador de guardado. Un fallo de red se devuelve como error, no se lanza. */
  async function call<T>(fn: () => Promise<T>): Promise<T | ActionErr> {
    setSaving((s) => s + 1)
    try {
      return await fn()
    } catch (e) {
      console.error('[MatrixEditor]', e)
      return { ok: false, error: UNEXPECTED_ERROR }
    } finally {
      setSaving((s) => s - 1)
    }
  }

  /** Acción estructural: limpia el error visible al empezar (los guardados por campo no lo hacen). */
  function runAction<T>(fn: () => Promise<T>): Promise<T | ActionErr> {
    setError(null)
    return call(fn)
  }

  /** Estado, borrar, vínculo, duplicar matriz: además bloquea sus botones mientras corre. */
  async function runBusy<T>(fn: () => Promise<T>): Promise<T | ActionErr> {
    setBusy(true)
    try { return await runAction(fn) } finally { setBusy(false) }
  }

  /** Agregar o duplicar pieza: bloquea chips, menú y duplicar mientras corre (evita piezas dobles). */
  async function runAdding<T>(fn: () => Promise<T>): Promise<T | ActionErr> {
    setAdding(true)
    try { return await runAction(fn) } finally { setAdding(false) }
  }

  /** Marca esos campos como cambiados localmente ahora (ver `lastLocalChange`). */
  function touchFields(fields: readonly string[]) {
    for (const f of fields) {
      localSeq.current += 1
      lastLocalChange.current.set(f, localSeq.current)
    }
  }

  /**
   * Registra un cambio local EN VUELO sobre esos campos y devuelve la función que lo cierra. Se llama en un
   * `finally`: un contador colgado dejaría el campo bloqueado para el sondeo mientras dure el editor.
   */
  function beginLocalChange(fields: readonly string[]): () => void {
    touchFields(fields)
    for (const f of fields) inFlightByField.current.set(f, (inFlightByField.current.get(f) ?? 0) + 1)
    let ended = false
    return () => {
      if (ended) return
      ended = true
      touchFields(fields)
      for (const f of fields) {
        const n = (inFlightByField.current.get(f) ?? 0) - 1
        if (n > 0) inFlightByField.current.set(f, n)
        else inFlightByField.current.delete(f)
      }
    }
  }

  /**
   * Registra un guardado de los campos dados. `stillLatest`, al terminar, dice cuáles siguen siendo el guardado
   * más reciente de su campo. Hoy Next 16 ejecuta las server functions de un cliente en serie (es un detalle de
   * implementación, no un contrato), así que las respuestas llegan en orden; esta guarda cubre el caso en que eso
   * cambie: una respuesta vieja nunca pisa ni revierte un guardado más nuevo del mismo campo.
   *
   * `end` cierra el contador de guardados en vuelo (bloque 3). Es el único punto por el que pasan todos los
   * guardados por campo, así que es el único sitio donde el sondeo puede enterarse de qué no debe tocar.
   */
  function beginFieldSave(fields: readonly string[]): { stillLatest: () => string[]; end: () => void } {
    const end = beginLocalChange(fields)
    const tokens = fields.map((f) => {
      saveSeq.current += 1
      latestSeqByField.current.set(f, saveSeq.current)
      return [f, saveSeq.current] as const
    })
    return {
      stillLatest: () => tokens.filter(([f, seq]) => latestSeqByField.current.get(f) === seq).map(([f]) => f),
      end,
    }
  }

  function fieldSaveFailed(message: string, fields: string[]) {
    setError({ message, fields })
  }

  function fieldSaveSucceeded(fields: string[]) {
    setError((e) => (e && e.fields.length > 0 && e.fields.every((f) => fields.includes(f)) ? null : e))
  }

  /** Descartar borradores y cerrar la matriz limpian cualquier error de guardado por campo (el mensaje
   * quedaría huérfano: el texto que lo causó ya no existe). Un error de acción (fields: []) se conserva. */
  function clearFieldErrors() {
    setError((e) => (e && e.fields.length > 0 ? null : e))
  }

  /**
   * Al soltar los borradores fallidos, esos campos vuelven a mostrar la versión confirmada. Sin sondeo no cambia
   * nada (tras un fallo el campo ya quedó en la confirmada); con sondeo, la confirmada pudo avanzar —la IA redactó
   * ese campo— mientras la fusión dejaba la pantalla quieta por el borrador.
   */
  function resyncFromConfirmed(drafts: Record<string, FailedItemDrafts>) {
    const back = new Map<string, Partial<ContentMatrixItem>>()
    for (const [id, d] of Object.entries(drafts)) {
      const confirmed = confirmedItems.current.get(id)
      if (confirmed) back.set(id, pickKeys<ContentMatrixItem>(confirmed, Object.keys(d) as ItemTextKey[]))
    }
    if (back.size === 0) return
    setItems((list) => {
      let changed = false
      const next = list.map((i) => {
        const b = back.get(i.id)
        if (!b || (Object.keys(b) as ItemTextKey[]).every((k) => i[k] === b[k])) return i
        changed = true
        return { ...i, ...b }
      })
      return changed ? next : list
    })
  }

  // ── Matriz ──

  /** Guardado optimista de campos de la matriz. `texts`: texto escrito por el usuario, a conservar si falla. */
  async function patchMatrix(patch: MatrixPatch, next: Partial<ContentMatrix>, texts: FailedMatrixDrafts = {}): Promise<PatchResult> {
    const keys = Object.keys(next) as (keyof ContentMatrix)[]
    const fieldOf = (k: string) => `matrix:${k}`
    const save = beginFieldSave(keys.map(fieldOf))
    const textKeys = Object.keys(texts) as MatrixTextKey[]
    setMatrix((m) => ({ ...m, ...next }))
    if (textKeys.length > 0) setFailedMatrixDrafts((f) => withoutMatrixDrafts(f, textKeys))

    let r: Awaited<ReturnType<typeof updateMatrix>> | ActionErr
    try {
      r = await call(() => updateMatrix(matrixId, patch))
    } finally {
      save.end()
    }
    const latestFields = save.stillLatest()
    const latestKeys = keys.filter((k) => latestFields.includes(fieldOf(k)))

    if (!r.ok) {
      if (latestKeys.length === 0) return 'superseded'
      const confirmed = pickKeys(confirmedMatrix.current, latestKeys)
      setMatrix((m) => ({ ...m, ...confirmed }))
      const kept = pickKeys(texts, textKeys.filter((k) => latestKeys.includes(k)))
      if (Object.keys(kept).length > 0) setFailedMatrixDrafts((f) => ({ ...f, ...kept }))
      fieldSaveFailed(r.error, latestFields)
      return 'failed'
    }
    confirmedMatrix.current = r.matrix
    if (latestKeys.length > 0) {
      const saved = pickKeys(r.matrix, latestKeys)
      setMatrix((m) => ({ ...m, ...saved, updated_at: r.matrix.updated_at }))
      fieldSaveSucceeded(latestFields)
    }
    return 'saved'
  }

  async function onTopics(topics: MatrixTopic[]) {
    const kept = new Set(topics.map((t) => t.name))
    const cleared = items.filter((i) => i.topic && !kept.has(i.topic)).map((i) => i.id)
    const confirmedTopics = new Map(cleared.map((id) => [id, confirmedItems.current.get(id)?.topic ?? null]))
    if (cleared.length > 0) setItems((list) => list.map((i) => (confirmedTopics.has(i.id) ? { ...i, topic: null } : i)))

    const result = await patchMatrix({ topics }, { topics_json: topics })
    if (result === 'saved') {
      // El servidor soltó esas piezas del tema: su versión confirmada también.
      for (const id of cleared) {
        const row = confirmedItems.current.get(id)
        if (row) confirmedItems.current.set(id, { ...row, topic: null })
      }
    } else if (result === 'failed' && cleared.length > 0) {
      setItems((list) => list.map((i) => (confirmedTopics.has(i.id) && i.topic === null ? { ...i, topic: confirmedTopics.get(i.id) ?? null } : i)))
    }
  }

  async function onStatus(to: MatrixStatus) {
    const r = await runBusy(() => setMatrixStatus(matrixId, to))
    if (!r.ok) {
      // Incluye `empty` (matriz sin piezas): el mensaje del servidor ya lo explica.
      setError({ message: r.error, fields: [] })
      if ('problems' in r && r.problems && r.problems.length > 0) setShowProblems(true)
      return
    }
    confirmedMatrix.current = r.matrix
    setShowProblems(false)
    setMatrix((m) => ({ ...m, ...pickKeys(r.matrix, STATUS_FIELDS) }))
    // Cerrada: los campos quedan de solo lectura, así que un reintento ya no es posible. Se limpian los
    // borradores fallidos que quedaran pendientes para no mostrar "cambios sin guardar" imposibles de resolver.
    if (to === 'closed') {
      // El ref y no el estado de la closure: pudieron fallar más guardados mientras esperaba la acción.
      resyncFromConfirmed(failedItemDraftsRef.current)
      setFailedItemDrafts({})
      setFailedMatrixDrafts({})
      clearFieldErrors()
    }
  }

  /**
   * Botón de la franja "cambios sin guardar": descarta todo el texto pendiente tras confirmar. No hace
   * falta remontar los hijos (header, barra de temas, hoja de la pieza): cada uno solo retiene un borrador
   * local mientras el campo está enfocado y lo suelta en `onBlur` (clic en este botón dispara ese blur
   * antes del `onClick`); con el borrador ya limpio, `value` cae de vuelta a `matrix`/`items` por props.
   */
  function discardUnsavedChanges() {
    if (!confirm('¿Descartar los cambios que no se pudieron guardar?')) return
    resyncFromConfirmed(failedItemDrafts)
    setFailedItemDrafts({})
    setFailedMatrixDrafts({})
    clearFieldErrors()
  }

  async function onRetryLink() {
    const r = await runBusy(() => retryMatrixRequirementLink(matrixId))
    if (!r.ok) { setError({ message: r.error, fields: [] }); return }
    const link = r.link
    if (link.ok) {
      confirmedMatrix.current = { ...confirmedMatrix.current, matrix_requirement_id: link.requirementId }
      setMatrix((m) => ({ ...m, matrix_requirement_id: link.requirementId }))
      setLinked({ id: link.requirementId, title: matrix.title, phase: 'pendiente', voided: false })
      setLinkError(null)
    } else {
      setLinkError(link.error)
    }
  }

  async function onDelete() {
    if (!confirm('¿Eliminar esta matriz y todas sus piezas? Si el requerimiento de matriz ya tiene tiempo registrado, se conserva.')) return
    const r = await runBusy(() => deleteMatrix(matrixId))
    if (!r.ok) { setError({ message: r.error, fields: [] }); return }
    router.replace('/matrices')
  }

  async function onDuplicate(p: TargetPeriod): Promise<string | null> {
    const r = await runBusy(() => duplicateMatrix(matrixId, { periodStart: p.periodStart, periodEnd: p.periodEnd }))
    if (!r.ok) return r.error
    if (!r.link.ok) rememberLinkError(r.id, r.link.error)
    setDupOpen(false)
    router.push(`/matrices/${r.id}`)
    return null
  }

  // ── Piezas ──

  async function onAdd(type: ContentType) {
    if (adding) return
    const r = await runAdding(() => addItem(matrixId, type))
    if (!r.ok) { setError({ message: r.error, fields: [] }); return }
    addConfirmedItem(r.item)
    setSelectedId(r.item.id)
  }

  /**
   * Pieza nueva que devolvió una acción (agregar o duplicar). El sondeo pudo haberla traído ANTES que la
   * respuesta de la acción: agregarla a ciegas la duplicaría en la tabla.
   */
  function addConfirmedItem(item: ContentMatrixItem) {
    const row = newestItem(item, confirmedItems.current.get(item.id))
    confirmedItems.current.set(row.id, row)
    setItems((list) => (list.some((i) => i.id === row.id) ? list : [...list, row]))
  }

  /** Guardado por campo de una pieza (ver comentario del componente). */
  async function onPatchItem(itemId: string, patch: ItemPatch) {
    const keys = Object.keys(patch) as (keyof ItemPatch)[]
    if (keys.length === 0) return
    const fieldOf = (k: string) => `item:${itemId}:${k}`
    const save = beginFieldSave(keys.map(fieldOf))
    const textKeys = keys.filter(isItemTextKey)
    setItems((list) => list.map((i) => (i.id === itemId ? { ...i, ...patch } : i)))
    if (textKeys.length > 0) setFailedItemDrafts((fd) => withoutItemDrafts(fd, itemId, textKeys))

    let r: Awaited<ReturnType<typeof updateItem>> | ActionErr
    try {
      r = await call(() => updateItem(itemId, patch))
    } finally {
      save.end()
    }
    const latestFields = save.stillLatest()
    const latestKeys = keys.filter((k) => latestFields.includes(fieldOf(k)))

    if (!r.ok) {
      if (latestKeys.length === 0) return
      const confirmed = confirmedItems.current.get(itemId)
      if (confirmed) {
        const back = pickKeys<ItemPatch>(confirmed, latestKeys)
        setItems((list) => list.map((i) => (i.id === itemId ? { ...i, ...back } : i)))
      }
      const failedText: FailedItemDrafts = {}
      for (const k of textKeys) {
        const v = patch[k]
        if (latestKeys.includes(k) && typeof v === 'string') failedText[k] = v
      }
      if (Object.keys(failedText).length > 0) {
        setFailedItemDrafts((fd) => ({ ...fd, [itemId]: { ...fd[itemId], ...failedText } }))
      }
      fieldSaveFailed(r.error, latestFields)
      return
    }
    confirmedItems.current.set(itemId, r.item)
    if (latestKeys.length > 0) {
      const saved = pickKeys<ItemPatch>(r.item, latestKeys)
      setItems((list) => list.map((i) => (i.id === itemId ? { ...i, ...saved, updated_at: r.item.updated_at } : i)))
      fieldSaveSucceeded(latestFields)
    }
  }

  async function onDuplicateItem(itemId: string) {
    if (adding) return
    const r = await runAdding(() => duplicateItem(itemId))
    if (!r.ok) { setError({ message: r.error, fields: [] }); return }
    addConfirmedItem(r.item)
  }

  async function onDeleteItem(itemId: string) {
    const shown = items.find((i) => i.id === itemId)
    if (!shown || !confirm('¿Eliminar esta pieza?')) return
    // Lápida ANTES de quitarla: un sondeo en vuelo (enviado antes del borrado) la traería de vuelta.
    deletedItemIds.current.add(itemId)
    setItems((list) => list.filter((i) => i.id !== itemId))
    if (selectedId === itemId) setSelectedId(null)
    const r = await runAction(() => deleteItem(itemId))
    if (!r.ok) {
      // El borrado falló y la pieza vuelve: con la lápida puesta, el sondeo la ignoraría para siempre (la IA
      // redactaría en la base y la pantalla no se enteraría, o no volvería si se hubiera caído de la lista).
      deletedItemIds.current.delete(itemId)
      const back = confirmedItems.current.get(itemId) ?? shown
      setItems((list) => (list.some((i) => i.id === itemId) ? list : [...list, back]))
      setError({ message: r.error, fields: [] })
      return
    }
    confirmedItems.current.delete(itemId)
    setFailedItemDrafts((fd) => withoutItemDrafts(fd, itemId, ITEM_TEXT_KEYS))
  }

  // ── Conversión ──

  function conversionFields(itemId: string): string[] {
    return CONVERSION_FIELDS.map((k) => `item:${itemId}:${k}`)
  }

  /** Aplica a una pieza los campos que la conversión cambió, en estado y en la versión confirmada. */
  function applyItemFields(itemId: string, fields: Partial<ContentMatrixItem>) {
    const confirmed = confirmedItems.current.get(itemId)
    if (confirmed) confirmedItems.current.set(itemId, { ...confirmed, ...fields })
    setItems((list) => list.map((i) => (i.id === itemId ? { ...i, ...fields } : i)))
  }

  /**
   * "Convertir ahora": registra el requerimiento de una pieza bloqueada sin esperar al barrido diario.
   *
   * La acción no devuelve la fila, así que el estado local se actualiza con lo que trae el resultado (basta:
   * el id del requerimiento o el motivo del bloqueo). Sin `router.refresh()` a propósito, igual que
   * `addItem`/`deleteItem`/`replanItem`: `convertItemNow` ya llama a `revalidateMatrix`, que en esta versión
   * de Next 16 re-renderiza la página; y como el estado local nunca se resincroniza desde las props, un
   * refresh extra sería una segunda vuelta al servidor que no actualiza ni `items` ni `voidedItemIds`.
   */
  async function onConvertNow(itemId: string) {
    if (busyItemId) return
    setBusyItemId(itemId)
    // La acción no devuelve la fila (ni su `updated_at`): sin este candado, un sondeo que leyó antes de la
    // conversión y llega después la desharía en pantalla.
    const endLocal = beginLocalChange(conversionFields(itemId))
    let r: Awaited<ReturnType<typeof convertItemNow>> | ActionErr
    try {
      r = await runAction(() => convertItemNow(itemId))
    } finally {
      endLocal()
    }
    setBusyItemId(null)
    if (!r.ok) { setError({ message: r.error, fields: [] }); return }

    const outcome = r.outcome
    if (outcome.kind === 'converted') {
      applyItemFields(itemId, {
        status: 'converted', requirement_id: outcome.requirementId,
        blocked_reason: null, blocked_at: null, converted_at: new Date().toISOString(),
      })
      setVoidedItemIds((ids) => ids.filter((id) => id !== itemId))
      // El título queda congelado al convertir: un borrador fallido suyo ya no se puede reintentar (el
      // campo está deshabilitado) y dejaría la franja de "cambios sin guardar" pidiendo algo imposible.
      // Se descarta solo ese, como al cerrar la matriz; el resto del brief sigue editable y reintentable.
      setFailedItemDrafts((fd) => withoutItemDrafts(fd, itemId, ['title']))
      return
    }
    if (outcome.kind === 'blocked') {
      applyItemFields(itemId, { status: 'blocked', blocked_reason: outcome.reason, blocked_at: new Date().toISOString() })
      setError({ message: `No se pudo convertir: ${outcome.reason}`, fields: [] })
      return
    }
    // `skipped`: la pieza no se tocó (otro proceso ganó, matriz sin aprobar o fallo transitorio). La fila
    // que se ve puede haber quedado vieja, así que se pide recargar — salvo cuando el motivo ya dice qué
    // hacer (aprobar la matriz), donde recargar no arregla nada y despista.
    const reload = outcome.reason === CONVERT_REASON_NOT_APPROVED ? '' : ' Recarga la página.'
    setError({ message: `No se convirtió: ${outcome.reason}${reload}`, fields: [] })
  }

  /** "Volver a planificar": la acción sí devuelve la fila, así que se aplica tal cual. */
  async function onReplan(itemId: string) {
    if (busyItemId) return
    setBusyItemId(itemId)
    const endLocal = beginLocalChange(conversionFields(itemId))
    let r: Awaited<ReturnType<typeof replanItem>> | ActionErr
    try {
      r = await runAction(() => replanItem(itemId))
    } finally {
      endLocal()
    }
    setBusyItemId(null)
    if (!r.ok) { setError({ message: r.error, fields: [] }); return }
    confirmedItems.current.set(r.item.id, r.item)
    setItems((list) => list.map((i) => (i.id === r.item.id ? r.item : i)))
    setVoidedItemIds((ids) => ids.filter((id) => id !== itemId))
  }

  // ── Generación con IA (bloque 3) ──

  /**
   * Fusiona una respuesta del sondeo sin pisar lo que el usuario está escribiendo. Corre fuera del render y solo
   * lee refs (y setters estables), así que da igual de qué render sea la closure. Las reglas:
   *
   * - pieza desconocida → se agrega, salvo que esté en las lápidas (borrada aquí);
   * - pieza conocida → la pantalla recibe solo los campos sin guardado en vuelo, sin borrador fallido y sin un
   *   cambio local posterior al envío de la consulta (`mergePolledItem`);
   * - toda fila aceptada va también a `confirmedItems`: es el destino del rollback. Si una pieza generada no
   *   estuviera ahí, un guardado fallido no revertiría nada y la pantalla quedaría por delante de la base; si
   *   se quedara la fila vieja, el siguiente fallo revertiría en pantalla el texto que escribió la IA;
   * - los temas van a `matrix` y a `confirmedMatrix`. Sin esto la barra seguiría con la lista vieja, y el
   *   siguiente cambio de temas mandaría a `updateMatrix` una lista SIN los de la IA: el servidor los borraría
   *   y soltaría el `topic` de todas las piezas generadas.
   */
  function applyGeneration(p: GenerationProgress, seqAtRequest: number) {
    const changedAfterRequest = (f: string) => (lastLocalChange.current.get(f) ?? 0) > seqAtRequest
    const inFlight = (f: string) => (inFlightByField.current.get(f) ?? 0) > 0
    const topicsStale = changedAfterRequest(TOPICS_FIELD)
    const topicsBusy = inFlight(TOPICS_FIELD)
    const failed = failedItemDraftsRef.current

    const merges: ItemMerge[] = []
    for (const polled of p.items) {
      if (deletedItemIds.current.has(polled.id)) continue
      const field = (k: string) => `item:${polled.id}:${k}`
      const drafts = failed[polled.id] as Partial<Record<string, string>> | undefined
      const m = mergePolledItem(polled, confirmedItems.current.get(polled.id), {
        // Quitar un tema suelta en el servidor el `topic` de las piezas que lo usaban (`onTopics`): mientras
        // ese guardado vuela, o si terminó después de enviarse la consulta, el `topic` de toda pieza espera.
        stale: (k) => changedAfterRequest(field(k)) || (k === 'topic' && topicsStale),
        screen: (k) => inFlight(field(k)) || drafts?.[k] !== undefined || (k === 'topic' && topicsBusy),
      })
      confirmedItems.current.set(polled.id, m.confirmed)
      merges.push(m)
    }
    if (merges.length > 0) setItems((list) => applyItemMerges(list, merges))

    if (!topicsStale) {
      const t = mergePolledTopics(p, confirmedMatrix.current)
      if (t) {
        confirmedMatrix.current = { ...confirmedMatrix.current, topics_json: t.topics, updated_at: t.updatedAt }
        if (!topicsBusy) setMatrix((m) => (sameTopics(m.topics_json, t.topics) ? m : { ...m, topics_json: t.topics }))
      }
    }
  }

  // Consulta al montar (matriz no cerrada) y sondeo mientras haya generación viva.
  const generation = useMatrixGeneration(matrixId, {
    enabled: matrix.status !== 'closed',
    initialSince,
    captureSeq: () => localSeq.current,
    onUpdate: applyGeneration,
  })
  const progress = generation.progress
  const writingItemIds = useMemo(() => progress?.writingItemIds ?? [], [progress])

  // El botón decide con `generationGate`, la MISMA función que `generateMatrix`, alimentada con el último hijo
  // de cada pieza que devuelve la ruta. El faltante sale de `usage`, que es lo que pintan los chips.
  const missingTotal = useMemo(() => missingByType(data.limits, usage).total, [data.limits, usage])
  const generateBlockedReason = matrix.status === 'draft'
    ? generateBlockReason({
      brandReady,
      missingTotal,
      items,
      itemJobs: progress ? progress.itemJobs : null,
      parentLive: progress?.phase === 'planning',
    })
    : null

  // Fallos a señalar en la tabla: piezas sin redactar, o regeneradas en esta pestaña. A una pieza con texto que
  // el usuario completó a mano después de un fallo no se le ofrece "Regenerar": pisaría lo que escribió.
  const visibleFailures = useMemo(() => {
    const byId = new Map(items.map((i) => [i.id, i]))
    const live = new Set(writingItemIds)
    return (progress?.failedItems ?? []).filter((f) => {
      const it = byId.get(f.itemId)
      return !!it && !live.has(f.itemId) && (isUnwrittenItem(it) || regeneratedHere.includes(f.itemId))
    })
  }, [items, progress, writingItemIds, regeneratedHere])

  async function onGenerate() {
    if (generating) return
    setGenerating(true)
    const r = await runAction(() => generateMatrix(matrixId))
    setGenerating(false)
    if (!r.ok) {
      setError({ message: r.error, fields: [] })
      // Lo que la pantalla creía pudo haber quedado viejo (ya había una generación, cambió el cupo): se relee.
      generation.kick()
      return
    }
    setStripDismissed(false)
    generation.kick({ planning: true })
  }

  /** Encola la redacción de una pieza ("Regenerar"). Devuelve el error a mostrar, o `null`. */
  async function regenerate(itemId: string, instructions?: string): Promise<string | null> {
    if (regeneratingIds.includes(itemId)) return null
    setRegeneratingIds((ids) => [...ids, itemId])
    const r = await call(() => regenerateItem(itemId, instructions?.trim() || null))
    setRegeneratingIds((ids) => ids.filter((id) => id !== itemId))
    if (!r.ok) return r.error
    setRegeneratedHere((ids) => (ids.includes(itemId) ? ids : [...ids, itemId]))
    generation.kick({ writingItemId: itemId })
    return null
  }

  const topicUsage = (name: string) => items.filter((i) => i.topic === name).length
  const sheetError = selected && error && error.fields.some((f) => f.startsWith(`item:${selected.id}:`)) ? error.message : null

  return (
    <div className="space-y-4">
      <MatrixHeader
        matrix={matrix}
        client={{ id: data.client.id, name: data.client.name, logo_url: data.client.logo_url }}
        periodLabel={data.period.label}
        usage={usage}
        estimated={data.limits.estimated}
        saveState={saveState}
        unsavedCount={unsavedCount}
        busy={busy}
        adding={adding}
        linked={linked}
        linkError={linkError}
        problems={problems}
        failedTitle={failedMatrixDrafts.title}
        plannedCount={plannedCount}
        blockedCount={blockedCount}
        onTitle={(title) => void patchMatrix({ title }, { title }, { title })}
        onLeadDays={(lead_days) => void patchMatrix({ lead_days }, { lead_days })}
        onAdd={(t) => void onAdd(t)}
        onStatus={(to) => void onStatus(to)}
        onDuplicate={() => setDupOpen(true)}
        onDelete={() => void onDelete()}
        onRetryLink={() => void onRetryLink()}
        generateBlockedReason={generateBlockedReason}
        generateNeedsProfile={generateBlockedReason === GENERATE_BLOCK_REASONS.noBrand}
        generating={generating}
        onGenerate={() => void onGenerate()}
      />

      <MatrixGenerationStrip
        progress={progress}
        observed={generation.observed}
        draft={matrix.status === 'draft'}
        pool={data.limits.unifiedPool != null}
        dismissed={stripDismissed}
        onDismiss={() => setStripDismissed(true)}
      />

      {error && (
        <p role="alert" className="text-xs text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">{error.message}</p>
      )}

      {/* Independiente de `error` (que una acción puede limpiar): sigue visible mientras quede texto sin guardar.
          El botón vive fuera del `role="status"` (hermano, no descendiente) para que un lector de pantalla no
          anuncie su etiqueta como parte del mensaje de estado. */}
      {hasUnsaved && (
        <div className="flex items-start gap-2 text-xs rounded-xl px-3 py-2 border border-amber-300/60 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          <div role="status" className="flex items-start gap-2 flex-1 min-w-0">
            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">edit_off</span>
            <span>
              Hay cambios sin guardar.
              {unsavedItemIds.length > 0 && ' Abre la pieza marcada y sal del campo para reintentar.'}
              {hasUnsavedMatrixText && ' Entra al título o al enfoque del mes y sal del campo para reintentar.'}
            </span>
          </div>
          <button type="button" onClick={discardUnsavedChanges} className="font-semibold underline whitespace-nowrap flex-shrink-0">
            Descartar cambios sin guardar
          </button>
        </div>
      )}

      <MatrixTopicsBar
        topics={matrix.topics_json}
        onChange={(topics) => void onTopics(topics)}
        usageCount={topicUsage}
        disabled={readOnly}
        notes={matrix.notes}
        failedNotes={failedMatrixDrafts.notes}
        onNotesChange={(notes) => void patchMatrix({ notes }, { notes }, { notes: notes ?? '' })}
      />

      <MatrixItemsTable
        items={sortedItems}
        matrix={matrix}
        usage={usage}
        problems={problems}
        selectedId={selectedId}
        readOnly={readOnly}
        adding={adding}
        unsavedIds={unsavedItemIds}
        linkedVoidedItemIds={voidedItemIds}
        busyItemId={busyItemId}
        today={data.today}
        onSelect={setSelectedId}
        onAdd={(t) => void onAdd(t)}
        onDuplicate={(id) => void onDuplicateItem(id)}
        onDelete={(id) => void onDeleteItem(id)}
        onConvertNow={(id) => void onConvertNow(id)}
        onReplan={(id) => void onReplan(id)}
        aiAvailable={brandReady === true}
        writingItemIds={writingItemIds}
        failedItems={visibleFailures}
        regeneratingIds={regeneratingIds}
        onRegenerate={(id) => {
          setError(null)
          void regenerate(id).then((err) => { if (err) setError({ message: err, fields: [] }) })
        }}
      />

      <MatrixItemSheet
        item={selected}
        topics={matrix.topics_json}
        period={data.period}
        assignableUsers={data.assignableUsers}
        // `readOnly` = matriz cerrada, y nada más. Una pieza convertida congela por su cuenta los cinco
        // campos que se copiaron al requerimiento (los mismos que rechaza `updateItem`) y deja el resto
        // del brief editable, que es justo lo que el requerimiento lee de la pieza.
        readOnly={readOnly}
        error={sheetError}
        failedDrafts={selected ? failedItemDrafts[selected.id] : undefined}
        onClose={() => setSelectedId(null)}
        onPatch={(patch) => { if (selected) void onPatchItem(selected.id, patch) }}
        aiAvailable={brandReady}
        writing={!!selected && writingItemIds.includes(selected.id)}
        failure={(selected && progress?.failedItems.find((f) => f.itemId === selected.id)) ?? null}
        regenerating={!!selected && regeneratingIds.includes(selected.id)}
        onRegenerate={(instructions) => (selected ? regenerate(selected.id, instructions) : Promise.resolve(null))}
      />

      <DuplicateMatrixDialog
        open={dupOpen}
        onOpenChange={setDupOpen}
        clientId={matrix.client_id}
        sourcePeriodStart={matrix.period_start}
        busy={busy}
        onDuplicate={onDuplicate}
      />
    </div>
  )
}
