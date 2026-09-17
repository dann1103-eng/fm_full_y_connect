'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ContentMatrix, ContentMatrixItem, ContentType, MatrixStatus, MatrixTopic } from '@/types/db'
import type { MatrixEditorData } from '@/lib/data/matrices'
import {
  compareMatrixItems, computeMatrixUsage, validateForApproval,
  type ActionErr, type ItemPatch, type TargetPeriod,
} from '@/lib/domain/matrix'
import {
  addItem, convertItemNow, deleteItem, deleteMatrix, duplicateItem, duplicateMatrix, replanItem,
  retryMatrixRequirementLink, setMatrixStatus, updateItem, updateMatrix,
} from '@/app/actions/matrices'
import { MatrixHeader, type SaveState } from './MatrixHeader'
import { MatrixTopicsBar } from './MatrixTopicsBar'
import { MatrixItemsTable } from './MatrixItemsTable'
import { ITEM_TEXT_KEYS, MatrixItemSheet, type FailedItemDrafts, type ItemTextKey } from './MatrixItemSheet'
import { DuplicateMatrixDialog } from './DuplicateMatrixDialog'
import { forgetLinkError, readLinkError, rememberLinkError } from './matrixLinkError'

type MatrixPatch = Parameters<typeof updateMatrix>[1]
type MatrixTextKey = 'title' | 'notes'
type FailedMatrixDrafts = Partial<Record<MatrixTextKey, string>>

/** Error visible. `fields`: llaves de los campos si vino de un guardado por campo; vacío si de una acción. */
interface EditorError { message: string; fields: string[] }

type PatchResult = 'saved' | 'failed' | 'superseded'

const UNEXPECTED_ERROR = 'No se pudo completar la acción. Revisa tu conexión e intenta de nuevo.'
const STATUS_FIELDS: readonly (keyof ContentMatrix)[] = ['status', 'approved_by', 'approved_at', 'closed_at', 'updated_at']

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
 */
export function MatrixEditor({ data }: { data: MatrixEditorData }) {
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

  // Últimas filas confirmadas por el servidor: se actualizan con cada respuesta exitosa y al agregar/duplicar.
  const confirmedMatrix = useRef<ContentMatrix>(data.matrix)
  const confirmedItems = useRef(new Map<string, ContentMatrixItem>(data.items.map((i) => [i.id, i])))
  // Secuencia por campo ("matrix:title", "item:<id>:copy"): solo el guardado más reciente de un campo puede
  // aplicar su respuesta o revertirlo.
  const saveSeq = useRef(0)
  const latestSeqByField = useRef(new Map<string, number>())

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

  /**
   * Registra un guardado de los campos dados y devuelve una función que, al terminar, dice cuáles siguen siendo
   * el guardado más reciente de su campo. Hoy Next 16 ejecuta las server functions de un cliente en serie (es un
   * detalle de implementación, no un contrato), así que las respuestas llegan en orden; esta guarda cubre el caso
   * en que eso cambie: una respuesta vieja nunca pisa ni revierte un guardado más nuevo del mismo campo.
   */
  function beginFieldSave(fields: readonly string[]): () => string[] {
    const tokens = fields.map((f) => {
      saveSeq.current += 1
      latestSeqByField.current.set(f, saveSeq.current)
      return [f, saveSeq.current] as const
    })
    return () => tokens.filter(([f, seq]) => latestSeqByField.current.get(f) === seq).map(([f]) => f)
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

  // ── Matriz ──

  /** Guardado optimista de campos de la matriz. `texts`: texto escrito por el usuario, a conservar si falla. */
  async function patchMatrix(patch: MatrixPatch, next: Partial<ContentMatrix>, texts: FailedMatrixDrafts = {}): Promise<PatchResult> {
    const keys = Object.keys(next) as (keyof ContentMatrix)[]
    const fieldOf = (k: string) => `matrix:${k}`
    const stillLatest = beginFieldSave(keys.map(fieldOf))
    const textKeys = Object.keys(texts) as MatrixTextKey[]
    setMatrix((m) => ({ ...m, ...next }))
    if (textKeys.length > 0) setFailedMatrixDrafts((f) => withoutMatrixDrafts(f, textKeys))

    const r = await call(() => updateMatrix(matrixId, patch))
    const latestFields = stillLatest()
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
    confirmedItems.current.set(r.item.id, r.item)
    setItems((list) => [...list, r.item])
    setSelectedId(r.item.id)
  }

  /** Guardado por campo de una pieza (ver comentario del componente). */
  async function onPatchItem(itemId: string, patch: ItemPatch) {
    const keys = Object.keys(patch) as (keyof ItemPatch)[]
    if (keys.length === 0) return
    const fieldOf = (k: string) => `item:${itemId}:${k}`
    const stillLatest = beginFieldSave(keys.map(fieldOf))
    const textKeys = keys.filter(isItemTextKey)
    setItems((list) => list.map((i) => (i.id === itemId ? { ...i, ...patch } : i)))
    if (textKeys.length > 0) setFailedItemDrafts((fd) => withoutItemDrafts(fd, itemId, textKeys))

    const r = await call(() => updateItem(itemId, patch))
    const latestFields = stillLatest()
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
    confirmedItems.current.set(r.item.id, r.item)
    setItems((list) => [...list, r.item])
  }

  async function onDeleteItem(itemId: string) {
    const shown = items.find((i) => i.id === itemId)
    if (!shown || !confirm('¿Eliminar esta pieza?')) return
    setItems((list) => list.filter((i) => i.id !== itemId))
    if (selectedId === itemId) setSelectedId(null)
    const r = await runAction(() => deleteItem(itemId))
    if (!r.ok) {
      const back = confirmedItems.current.get(itemId) ?? shown
      setItems((list) => (list.some((i) => i.id === itemId) ? list : [...list, back]))
      setError({ message: r.error, fields: [] })
      return
    }
    confirmedItems.current.delete(itemId)
    setFailedItemDrafts((fd) => withoutItemDrafts(fd, itemId, ITEM_TEXT_KEYS))
  }

  // ── Conversión ──

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
    const r = await runAction(() => convertItemNow(itemId))
    setBusyItemId(null)
    if (!r.ok) { setError({ message: r.error, fields: [] }); return }

    const outcome = r.outcome
    if (outcome.kind === 'converted') {
      applyItemFields(itemId, {
        status: 'converted', requirement_id: outcome.requirementId,
        blocked_reason: null, converted_at: new Date().toISOString(),
      })
      setVoidedItemIds((ids) => ids.filter((id) => id !== itemId))
      // El título queda congelado al convertir: un borrador fallido suyo ya no se puede reintentar (el
      // campo está deshabilitado) y dejaría la franja de "cambios sin guardar" pidiendo algo imposible.
      // Se descarta solo ese, como al cerrar la matriz; el resto del brief sigue editable y reintentable.
      setFailedItemDrafts((fd) => withoutItemDrafts(fd, itemId, ['title']))
      return
    }
    if (outcome.kind === 'blocked') {
      applyItemFields(itemId, { status: 'blocked', blocked_reason: outcome.reason })
      setError({ message: `No se pudo convertir: ${outcome.reason}`, fields: [] })
      return
    }
    // `skipped`: la pieza no se tocó (otro proceso ganó, matriz sin aprobar o fallo transitorio). La fila
    // que se ve puede haber quedado vieja, así que se pide recargar.
    setError({ message: `No se convirtió: ${outcome.reason} Recarga la página.`, fields: [] })
  }

  /** "Volver a planificar": la acción sí devuelve la fila, así que se aplica tal cual. */
  async function onReplan(itemId: string) {
    if (busyItemId) return
    setBusyItemId(itemId)
    const r = await runAction(() => replanItem(itemId))
    setBusyItemId(null)
    if (!r.ok) { setError({ message: r.error, fields: [] }); return }
    confirmedItems.current.set(r.item.id, r.item)
    setItems((list) => list.map((i) => (i.id === r.item.id ? r.item : i)))
    setVoidedItemIds((ids) => ids.filter((id) => id !== itemId))
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
        onSelect={setSelectedId}
        onAdd={(t) => void onAdd(t)}
        onDuplicate={(id) => void onDuplicateItem(id)}
        onDelete={(id) => void onDeleteItem(id)}
        onConvertNow={(id) => void onConvertNow(id)}
        onReplan={(id) => void onReplan(id)}
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
