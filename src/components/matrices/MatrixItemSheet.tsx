'use client'

import { useState } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { ContentMatrixItem, ContentType, MatrixObjective, MatrixTopic } from '@/types/db'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import { formatDeadlineDate } from '@/lib/domain/deadline'
import {
  isIsoDate, MATRIX_CONTENT_TYPES, MATRIX_OBJECTIVES, MATRIX_OBJECTIVE_LABELS, MATRIX_TEXT_LIMITS, type ItemPatch,
} from '@/lib/domain/matrix'

export type ItemTextKey = 'title' | 'copy' | 'script' | 'visual_style' | 'hashtags' | 'cta'
export const ITEM_TEXT_KEYS: readonly ItemTextKey[] = ['title', 'copy', 'script', 'visual_style', 'hashtags', 'cta']
/** Texto que el usuario intentó guardar y falló, por campo. */
export type FailedItemDrafts = Partial<Record<ItemTextKey, string>>

interface Props {
  item: ContentMatrixItem | null
  topics: MatrixTopic[]
  period: { periodStart: string; periodEnd: string; label: string }
  readOnly: boolean
  /** Error del último guardado de esta pieza (se repite aquí porque en móvil el panel tapa la página). */
  error: string | null
  /** Textos cuyo guardado falló: se muestran en vez del valor confirmado para no perderlos. */
  failedDrafts: FailedItemDrafts | undefined
  onClose: () => void
  onPatch: (patch: ItemPatch) => void
}

const inputBase = 'w-full rounded-xl border bg-fm-background px-3 py-2 text-sm text-fm-on-surface disabled:opacity-60'
// Un solo color de borde por clase (sin depender del orden de la hoja de estilos para que gane el de error).
const inputCls = `${inputBase} border-fm-surface-container-high`
const inputErrorCls = `${inputBase} border-fm-error/60`
const labelCls = 'block text-[11px] uppercase tracking-wider text-fm-on-surface-variant mb-1'

/**
 * El cuerpo se monta con `key={item.id}`: al cambiar de pieza los borradores arrancan limpios sin
 * sincronizar estado en un efecto.
 */
export function MatrixItemSheet({ item, ...rest }: Props) {
  if (!item) return null
  return <ItemSheet key={item.id} item={item} {...rest} />
}

type Drafts = Partial<Record<ItemTextKey | 'deadline', string>>

function withoutKeys(d: Drafts, keys: readonly (keyof Drafts)[]): Drafts {
  const next = { ...d }
  for (const k of keys) delete next[k]
  return next
}

function ItemSheet({ item, topics, period, readOnly, error, failedDrafts, onClose, onPatch }: Omit<Props, 'item'> & { item: ContentMatrixItem }) {
  // Borradores solo de los campos que se están editando. Al perder foco se guardan y se descartan; lo mostrado
  // sale entonces del texto fallido (si el último guardado de ese campo falló) o de `item` (optimista o confirmado).
  const [drafts, setDrafts] = useState<Drafts>({})
  const [dateError, setDateError] = useState<string | null>(null)

  const rangeLabel = `${formatDeadlineDate(period.periodStart)} y ${formatDeadlineDate(period.periodEnd)}`
  const savedText = (key: ItemTextKey): string => (key === 'title' ? item.title : item[key] ?? '')
  const shownText = (key: ItemTextKey): string => drafts[key] ?? failedDrafts?.[key] ?? savedText(key)
  const validDeadline = (d: string) => isIsoDate(d) && d >= period.periodStart && d <= period.periodEnd

  /** Patch con los borradores de texto que cambiaron (o cuyo guardado anterior falló: se reintenta). */
  function pendingTextPatch(keys: readonly ItemTextKey[]): ItemPatch {
    const patch: ItemPatch = {}
    for (const k of keys) {
      const v = drafts[k]
      if (v === undefined) continue
      if (v.trim() !== savedText(k).trim() || failedDrafts?.[k] !== undefined) patch[k] = v
    }
    return patch
  }

  function commitText(key: ItemTextKey) {
    const patch = pendingTextPatch([key])
    setDrafts((d) => withoutKeys(d, [key]))
    if (Object.keys(patch).length > 0) onPatch(patch)
  }

  // La fecha se guarda al perder foco (como los textos): así teclearla dígito a dígito no dispara guardados
  // intermedios. Un valor incompleto o fuera del período se descarta con el rango válido a la vista.
  function commitDeadline() {
    const v = drafts.deadline
    if (v === undefined) return
    setDrafts((d) => withoutKeys(d, ['deadline']))
    if (!validDeadline(v)) { setDateError(`La fecha debe estar entre ${rangeLabel}.`); return }
    if (v !== item.deadline) onPatch({ deadline: v })
  }

  /** Cerrar con Escape o clic fuera no dispara el blur del campo activo: se guarda lo pendiente aquí. */
  function close() {
    const patch = pendingTextPatch(ITEM_TEXT_KEYS)
    if (drafts.deadline !== undefined && validDeadline(drafts.deadline) && drafts.deadline !== item.deadline) {
      patch.deadline = drafts.deadline
    }
    if (Object.keys(patch).length > 0) onPatch(patch)
    onClose()
  }

  const text = (key: ItemTextKey, label: string, rows?: number, placeholder?: string) => {
    const id = `matrix-item-${key}`
    const failed = failedDrafts?.[key]
    const common = {
      id,
      value: shownText(key),
      disabled: readOnly,
      placeholder,
      maxLength: MATRIX_TEXT_LIMITS[key],
      'aria-invalid': failed !== undefined || undefined,
      // Con texto fallido pendiente, enfocar lo carga como borrador: al salir del campo (o al cerrar) se reintenta.
      onFocus: () => { if (failed !== undefined) setDrafts((d) => (d[key] === undefined ? { ...d, [key]: failed } : d)) },
      onBlur: () => commitText(key),
      className: failed !== undefined ? inputErrorCls : inputCls,
    }
    return (
      <div>
        <label htmlFor={id} className={labelCls}>
          {label}{failed !== undefined && <span className="ml-1 normal-case tracking-normal text-fm-error">· sin guardar</span>}
        </label>
        {rows ? (
          <textarea rows={rows} {...common} onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))} />
        ) : (
          <input {...common} onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))} />
        )}
      </div>
    )
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) close() }}>
      <SheetContent fullScreenOnMobile className="w-full sm:!max-w-md flex flex-col p-0 gap-0 overflow-hidden">
        <SheetHeader className="px-5 pt-5 pb-3 pr-12 border-b border-fm-outline-variant/10">
          <SheetTitle className="text-base font-semibold text-fm-on-surface truncate">{item.title || 'Pieza sin título'}</SheetTitle>
          <SheetDescription className="text-[11px] text-fm-on-surface-variant">
            Período {period.label}{readOnly ? ' · solo lectura' : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && (
            <p role="alert" className="text-xs text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">{error}</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="matrix-item-type" className={labelCls}>Tipo</label>
              <select id="matrix-item-type" value={item.content_type} disabled={readOnly} className={inputCls}
                onChange={(e) => onPatch({ content_type: e.target.value as ContentType })}>
                {MATRIX_CONTENT_TYPES.map((t) => <option key={t} value={t}>{CONTENT_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="matrix-item-deadline" className={labelCls}>Entrega</label>
              <input id="matrix-item-deadline" type="date" value={drafts.deadline ?? item.deadline}
                min={period.periodStart} max={period.periodEnd} disabled={readOnly} className={inputCls}
                aria-describedby="matrix-item-deadline-hint"
                onChange={(e) => { setDateError(null); const v = e.target.value; setDrafts((d) => ({ ...d, deadline: v })) }}
                onBlur={commitDeadline} />
            </div>
            <div>
              <label htmlFor="matrix-item-topic" className={labelCls}>Tema</label>
              <select id="matrix-item-topic" value={item.topic ?? ''} disabled={readOnly} className={inputCls}
                onChange={(e) => onPatch({ topic: e.target.value || null })}>
                <option value="">Sin tema</option>
                {topics.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="matrix-item-objective" className={labelCls}>Objetivo</label>
              <select id="matrix-item-objective" value={item.objective ?? ''} disabled={readOnly} className={inputCls}
                onChange={(e) => onPatch({ objective: (e.target.value || null) as MatrixObjective | null })}>
                <option value="">—</option>
                {MATRIX_OBJECTIVES.map((o) => <option key={o} value={o}>{MATRIX_OBJECTIVE_LABELS[o]}</option>)}
              </select>
            </div>
          </div>
          <p id="matrix-item-deadline-hint" className={`-mt-2 text-[11px] ${dateError ? 'text-fm-error' : 'text-fm-on-surface-variant'}`}>
            {dateError ?? `Entrega entre ${rangeLabel}.`}
          </p>

          {text('title', 'Título', undefined, 'Ej. Llegó el pumpkin latte')}
          {text('copy', 'Copy', 4, 'Texto de la publicación')}
          {text('script', 'Guion', 6, 'Escenas, locución, textos en pantalla…')}
          {text('visual_style', 'Estilo visual', 2, 'Paleta, referencias, tono de imagen')}
          {text('hashtags', 'Hashtags', undefined, '#marca #tema')}
          {text('cta', 'Llamado a la acción', undefined, 'Ej. Ven a probarlo esta semana')}

          <label className="flex items-center gap-2 text-sm text-fm-on-surface">
            <input type="checkbox" checked={item.needs_production} disabled={readOnly}
              onChange={(e) => onPatch({ needs_production: e.target.checked })} />
            Necesita producción (grabación / sesión)
          </label>
        </div>
      </SheetContent>
    </Sheet>
  )
}
