'use client'

import { useState } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { ContentMatrixItem, ContentType, MatrixObjective, MatrixTopic } from '@/types/db'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import { formatDeadlineDate } from '@/lib/domain/deadline'
import {
  isIsoDate, MATRIX_CONTENT_TYPES, MATRIX_OBJECTIVES, MATRIX_OBJECTIVE_LABELS, type ItemPatch,
} from '@/lib/domain/matrix'

interface Props {
  item: ContentMatrixItem | null
  topics: MatrixTopic[]
  period: { periodStart: string; periodEnd: string; label: string }
  readOnly: boolean
  /** Último error del editor: se repite dentro del panel porque en móvil lo tapa por completo. */
  error: string | null
  onClose: () => void
  onPatch: (patch: ItemPatch) => void
}

type TextKey = 'title' | 'copy' | 'script' | 'visual_style' | 'hashtags' | 'cta'
const TEXT_KEYS: TextKey[] = ['title', 'copy', 'script', 'visual_style', 'hashtags', 'cta']

type Drafts = Partial<Record<TextKey | 'deadline', string>>

const inputCls = 'w-full rounded-xl border border-fm-surface-container-high bg-fm-background px-3 py-2 text-sm text-fm-on-surface disabled:opacity-60'
const labelCls = 'block text-[11px] uppercase tracking-wider text-fm-on-surface-variant mb-1'

/**
 * El cuerpo se monta con `key={item.id}`: al cambiar de pieza los borradores arrancan limpios sin
 * sincronizar estado en un efecto.
 */
export function MatrixItemSheet({ item, ...rest }: Props) {
  if (!item) return null
  return <ItemSheet key={item.id} item={item} {...rest} />
}

function withoutKeys(d: Drafts, keys: readonly (keyof Drafts)[]): Drafts {
  const next = { ...d }
  for (const k of keys) delete next[k]
  return next
}

function ItemSheet({ item, topics, period, readOnly, error, onClose, onPatch }: Omit<Props, 'item'> & { item: ContentMatrixItem }) {
  // Borradores solo de los campos que se están editando. Al perder foco se guardan y se descartan: el valor
  // mostrado vuelve a salir de `item`, así el guardado optimista se ve al instante y un error (que revierte
  // `item`) también.
  const [drafts, setDrafts] = useState<Drafts>({})
  const [dateError, setDateError] = useState<string | null>(null)

  const rangeLabel = `${formatDeadlineDate(period.periodStart)} y ${formatDeadlineDate(period.periodEnd)}`
  const savedText = (key: TextKey): string => (key === 'title' ? item.title : item[key] ?? '')
  const shownText = (key: TextKey): string => drafts[key] ?? savedText(key)

  function pendingTextPatch(keys: readonly TextKey[]): ItemPatch {
    const patch: ItemPatch = {}
    for (const k of keys) {
      const v = drafts[k]
      if (v !== undefined && v.trim() !== savedText(k).trim()) patch[k] = v
    }
    return patch
  }

  function commitText(key: TextKey) {
    const patch = pendingTextPatch([key])
    setDrafts((d) => withoutKeys(d, [key]))
    if (Object.keys(patch).length > 0) onPatch(patch)
  }

  function onDateChange(value: string) {
    setDateError(null)
    // El selector nativo (y el tecleo completo) produce fechas válidas: se guardan al momento. Un valor a
    // medio teclear o fuera del período queda en borrador hasta perder foco.
    if (isIsoDate(value) && value >= period.periodStart && value <= period.periodEnd) {
      setDrafts((d) => withoutKeys(d, ['deadline']))
      if (value !== item.deadline) onPatch({ deadline: value })
    } else {
      setDrafts((d) => ({ ...d, deadline: value }))
    }
  }

  function onDateBlur() {
    if (drafts.deadline === undefined) return
    setDrafts((d) => withoutKeys(d, ['deadline']))
    setDateError(`La fecha debe estar entre ${rangeLabel}.`)
  }

  /** Cerrar con Escape o clic fuera no dispara el blur del campo activo: se guarda lo pendiente aquí. */
  function close() {
    const patch = pendingTextPatch(TEXT_KEYS)
    if (Object.keys(patch).length > 0) onPatch(patch)
    onClose()
  }

  const text = (key: TextKey, label: string, rows?: number, placeholder?: string) => {
    const id = `matrix-item-${key}`
    return (
      <div>
        <label htmlFor={id} className={labelCls}>{label}</label>
        {rows ? (
          <textarea id={id} rows={rows} value={shownText(key)} disabled={readOnly} placeholder={placeholder}
            onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))} onBlur={() => commitText(key)} className={inputCls} />
        ) : (
          <input id={id} value={shownText(key)} disabled={readOnly} placeholder={placeholder}
            maxLength={key === 'title' ? 200 : undefined}
            onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))} onBlur={() => commitText(key)} className={inputCls} />
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
                onChange={(e) => onDateChange(e.target.value)} onBlur={onDateBlur} />
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
          <p className={`-mt-2 text-[11px] ${dateError ? 'text-fm-error' : 'text-fm-on-surface-variant'}`}>
            {dateError ?? `Entrega entre ${rangeLabel}.`}
          </p>

          {text('title', 'Título', undefined, 'Ej. Llegó el pumpkin latte')}
          {text('copy', 'Copy', 4, 'Texto de la publicación')}
          {text('script', 'Guión', 6, 'Escenas, locución, textos en pantalla…')}
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
