'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ContentMatrix, ContentMatrixItem, ContentType, MatrixStatus, MatrixTopic } from '@/types/db'
import type { MatrixEditorData } from '@/lib/data/matrices'
import {
  compareMatrixItems, computeMatrixUsage, validateForApproval,
  type ActionErr, type ItemPatch, type TargetPeriod,
} from '@/lib/domain/matrix'
import {
  addItem, deleteItem, deleteMatrix, duplicateItem, duplicateMatrix, listTargetPeriods,
  retryMatrixRequirementLink, setMatrixStatus, updateItem, updateMatrix,
} from '@/app/actions/matrices'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MatrixHeader } from './MatrixHeader'
import { MatrixTopicsBar } from './MatrixTopicsBar'
import { MatrixItemsTable } from './MatrixItemsTable'
import { MatrixItemSheet } from './MatrixItemSheet'
import { forgetLinkError, readLinkError, rememberLinkError } from './matrixLinkError'

type MatrixPatch = Parameters<typeof updateMatrix>[1]

const UNEXPECTED_ERROR = 'No se pudo completar la acción. Revisa tu conexión e intenta de nuevo.'

/** Copia de `src` solo con las llaves indicadas (para aplicar del servidor únicamente lo que se editó). */
function pickKeys<T extends object>(src: T, keys: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {}
  for (const k of keys) out[k] = src[k]
  return out
}

/**
 * Estado local de matriz y piezas, inicializado desde props y nunca resincronizado con `router.refresh()`:
 * cada acción devuelve la fila y se aplica aquí. Uso, fuera de plan y problemas de aprobación se derivan en
 * cliente con las funciones puras del dominio.
 */
export function MatrixEditor({ data }: { data: MatrixEditorData }) {
  const router = useRouter()
  const [matrix, setMatrix] = useState<ContentMatrix>(data.matrix)
  const [items, setItems] = useState<ContentMatrixItem[]>(data.items)
  const [linked, setLinked] = useState(data.linkedRequirement)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [saving, setSaving] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showProblems, setShowProblems] = useState(false)
  const [dupOpen, setDupOpen] = useState(false)
  const [dupPeriods, setDupPeriods] = useState<{ periods: TargetPeriod[]; existing: Record<string, string> } | null>(null)
  const [dupError, setDupError] = useState<string | null>(null)

  // Motivo real del vínculo fallido al crear o duplicar (lo guardó quien navegó hasta aquí). Se lee después
  // de montar y no en un inicializador de useState: el servidor no tiene sessionStorage, así que leerlo en
  // el render haría que la franja del HTML del servidor (sin motivo) y la de la hidratación no coincidieran.
  // El setState va en un microtask (patrón del repo, ver TopNav) y la llave se borra ahí mismo, no antes:
  // con StrictMode el efecto corre dos veces y la primera ejecución se cancela sin consumir la llave.
  const matrixId = data.matrix.id
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

  const usage = useMemo(() => computeMatrixUsage(items, data.limits), [items, data.limits])
  const sortedItems = useMemo(() => [...items].sort(compareMatrixItems), [items])
  // Tras un intento fallido de aprobar, los problemas se recalculan en vivo: se apagan al corregir cada pieza.
  const problems = useMemo(
    () => (showProblems ? validateForApproval(items, data.period).problems : []),
    [showProblems, items, data.period],
  )
  const selected = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId])
  const readOnly = matrix.status === 'closed'

  /** Ejecuta una server action con indicador de guardado. Un fallo de red se devuelve como error, no se lanza. */
  async function run<T>(fn: () => Promise<T>): Promise<T | ActionErr> {
    setSaving((s) => s + 1)
    setError(null)
    try {
      return await fn()
    } catch (e) {
      console.error('[MatrixEditor]', e)
      return { ok: false, error: UNEXPECTED_ERROR }
    } finally {
      setSaving((s) => s - 1)
    }
  }

  /** Acción estructural (estado, borrar, vínculo): además bloquea sus botones mientras corre. */
  async function runBusy<T>(fn: () => Promise<T>): Promise<T | ActionErr> {
    setBusy(true)
    try { return await run(fn) } finally { setBusy(false) }
  }

  // ── Matriz ──
  /** Actualización optimista de campos de la matriz; revierte esos campos si la acción falla. */
  async function patchMatrix(patch: MatrixPatch, next: Partial<ContentMatrix>): Promise<boolean> {
    const keys = Object.keys(next) as (keyof ContentMatrix)[]
    const prev = pickKeys(matrix, keys)
    setMatrix((m) => ({ ...m, ...next }))
    const r = await run(() => updateMatrix(matrix.id, patch))
    if (!r.ok) {
      setMatrix((m) => ({ ...m, ...prev }))
      setError(r.error)
      return false
    }
    // Solo lo editado (normalizado por el servidor): no pisa otro guardado optimista en curso.
    setMatrix((m) => ({ ...m, ...pickKeys(r.matrix, keys), updated_at: r.matrix.updated_at }))
    return true
  }

  async function onTopics(topics: MatrixTopic[]) {
    const kept = new Set(topics.map((t) => t.name))
    const cleared = new Map(items.filter((i) => i.topic && !kept.has(i.topic)).map((i) => [i.id, i.topic]))
    if (cleared.size > 0) setItems((list) => list.map((i) => (cleared.has(i.id) ? { ...i, topic: null } : i)))
    const ok = await patchMatrix({ topics }, { topics_json: topics })
    if (!ok && cleared.size > 0) {
      setItems((list) => list.map((i) => (cleared.has(i.id) && i.topic === null ? { ...i, topic: cleared.get(i.id) ?? null } : i)))
    }
  }

  async function onStatus(to: MatrixStatus) {
    const r = await runBusy(() => setMatrixStatus(matrix.id, to))
    if (!r.ok) {
      // Incluye `empty` (matriz sin piezas): el mensaje del servidor ya lo explica.
      setError(r.error)
      if ('problems' in r && r.problems && r.problems.length > 0) setShowProblems(true)
      return
    }
    setShowProblems(false)
    setMatrix(r.matrix)
  }

  async function onRetryLink() {
    const r = await runBusy(() => retryMatrixRequirementLink(matrix.id))
    if (!r.ok) { setError(r.error); return }
    const link = r.link
    if (link.ok) {
      setMatrix((m) => ({ ...m, matrix_requirement_id: link.requirementId }))
      setLinked({ id: link.requirementId, title: matrix.title, phase: 'pendiente' })
      setLinkError(null)
    } else {
      setLinkError(link.error)
    }
  }

  async function onDelete() {
    if (!confirm('¿Eliminar esta matriz y todas sus piezas? Si el requerimiento de matriz ya tiene tiempo registrado, se conserva.')) return
    const r = await runBusy(() => deleteMatrix(matrix.id))
    if (!r.ok) { setError(r.error); return }
    router.replace('/matrices')
  }

  async function openDuplicate() {
    setDupError(null)
    setDupOpen(true)
    if (dupPeriods) return
    try {
      const r = await listTargetPeriods(matrix.client_id)
      if (r.ok) setDupPeriods({ periods: r.periods, existing: r.existing })
      else setDupError(r.error)
    } catch (e) {
      console.error('[MatrixEditor] listTargetPeriods', e)
      setDupError(UNEXPECTED_ERROR)
    }
  }

  async function onDuplicate(p: TargetPeriod) {
    setDupError(null)
    const r = await runBusy(() => duplicateMatrix(matrix.id, { periodStart: p.periodStart, periodEnd: p.periodEnd }))
    if (!r.ok) { setDupError(r.error); return }
    if (!r.link.ok) rememberLinkError(r.id, r.link.error)
    setDupOpen(false)
    router.push(`/matrices/${r.id}`)
  }

  // ── Piezas ──
  async function onAdd(type: ContentType) {
    const r = await run(() => addItem(matrix.id, type))
    if (!r.ok) { setError(r.error); return }
    setItems((list) => [...list, r.item])
    setSelectedId(r.item.id)
  }

  /** Guardado por campo, optimista: en error revierte solo los campos del patch y muestra el mensaje. */
  async function onPatchItem(itemId: string, patch: ItemPatch) {
    const before = items.find((i) => i.id === itemId)
    if (!before) return
    const keys = Object.keys(patch) as (keyof ItemPatch)[]
    const prev = pickKeys<ItemPatch>(before, keys)
    setItems((list) => list.map((i) => (i.id === itemId ? { ...i, ...patch } : i)))
    const r = await run(() => updateItem(itemId, patch))
    if (!r.ok) {
      setItems((list) => list.map((i) => (i.id === itemId ? { ...i, ...prev } : i)))
      setError(r.error)
      return
    }
    const saved = pickKeys<ItemPatch>(r.item, keys)
    setItems((list) => list.map((i) => (i.id === itemId ? { ...i, ...saved, updated_at: r.item.updated_at } : i)))
  }

  async function onDuplicateItem(itemId: string) {
    const r = await run(() => duplicateItem(itemId))
    if (!r.ok) { setError(r.error); return }
    setItems((list) => [...list, r.item])
  }

  async function onDeleteItem(itemId: string) {
    const removed = items.find((i) => i.id === itemId)
    if (!removed || !confirm('¿Eliminar esta pieza?')) return
    setItems((list) => list.filter((i) => i.id !== itemId))
    if (selectedId === itemId) setSelectedId(null)
    const r = await run(() => deleteItem(itemId))
    if (!r.ok) {
      setItems((list) => (list.some((i) => i.id === itemId) ? list : [...list, removed]))
      setError(r.error)
    }
  }

  const topicUsage = (name: string) => items.filter((i) => i.topic === name).length

  return (
    <div className="space-y-4">
      <MatrixHeader
        matrix={matrix}
        client={{ id: data.client.id, name: data.client.name, logo_url: data.client.logo_url }}
        periodLabel={data.period.label}
        usage={usage}
        estimated={data.limits.estimated}
        saving={saving > 0}
        busy={busy}
        linked={linked}
        linkError={linkError}
        problems={problems}
        onTitle={(title) => void patchMatrix({ title }, { title })}
        onAdd={(t) => void onAdd(t)}
        onStatus={(to) => void onStatus(to)}
        onDuplicate={() => void openDuplicate()}
        onDelete={() => void onDelete()}
        onRetryLink={() => void onRetryLink()}
      />

      {error && (
        <p role="alert" className="text-xs text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">{error}</p>
      )}

      <MatrixTopicsBar
        topics={matrix.topics_json}
        onChange={(topics) => void onTopics(topics)}
        usageCount={topicUsage}
        disabled={readOnly}
        notes={matrix.notes}
        onNotesChange={(notes) => void patchMatrix({ notes }, { notes })}
      />

      <MatrixItemsTable
        items={sortedItems}
        usage={usage}
        problems={problems}
        selectedId={selectedId}
        readOnly={readOnly}
        onSelect={(id) => { setError(null); setSelectedId(id) }}
        onAdd={(t) => void onAdd(t)}
        onDuplicate={(id) => void onDuplicateItem(id)}
        onDelete={(id) => void onDeleteItem(id)}
      />

      <MatrixItemSheet
        item={selected}
        topics={matrix.topics_json}
        period={data.period}
        readOnly={readOnly || selected?.status === 'converted'}
        error={error}
        onClose={() => setSelectedId(null)}
        onPatch={(patch) => { if (selected) void onPatchItem(selected.id, patch) }}
      />

      <Dialog open={dupOpen} onOpenChange={setDupOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl p-0 gap-0 border border-fm-outline-variant/20">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-fm-outline-variant/10">
            <DialogTitle className="text-lg font-semibold text-fm-on-surface">Duplicar matriz</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-4 space-y-2">
            <p className="text-sm text-fm-on-surface-variant">Elige el período destino. Se copian temas, notas y piezas con las fechas corridas.</p>
            {!dupPeriods && !dupError && <p className="text-xs text-fm-on-surface-variant">Cargando períodos…</p>}
            {dupPeriods?.periods.filter((p) => p.periodStart !== matrix.period_start).map((p) => {
              const exists = !!dupPeriods.existing[p.periodStart]
              return (
                <button key={p.periodStart} type="button" disabled={exists || busy} onClick={() => void onDuplicate(p)}
                  className="w-full text-left rounded-xl border border-fm-surface-container-high px-3 py-2 text-sm text-fm-on-surface hover:bg-fm-surface-container-low disabled:opacity-50">
                  {p.label}{exists && <span className="text-[11px] text-fm-on-surface-variant"> · ya tiene matriz</span>}
                </button>
              )
            })}
            {dupError && (
              <p className="text-xs text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">{dupError}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
