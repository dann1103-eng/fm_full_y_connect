'use client'

import { useState } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { ContentMatrixItem, ContentType, MatrixObjective, MatrixTopic } from '@/types/db'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import { formatDeadlineDate } from '@/lib/domain/deadline'
import {
  isIsoDate, MATRIX_CONTENT_TYPES, MATRIX_ESTIMATE_MAX_MINUTES, MATRIX_MAX_ASSIGNEES, MATRIX_OBJECTIVES,
  MATRIX_OBJECTIVE_LABELS, MATRIX_TEXT_LIMITS, type ItemPatch,
} from '@/lib/domain/matrix'

export type ItemTextKey = 'title' | 'copy' | 'script' | 'visual_style' | 'hashtags' | 'cta'
export const ITEM_TEXT_KEYS: readonly ItemTextKey[] = ['title', 'copy', 'script', 'visual_style', 'hashtags', 'cta']
/** Texto que el usuario intentó guardar y falló, por campo. */
export type FailedItemDrafts = Partial<Record<ItemTextKey, string>>

/** Tope de horas del estimado, derivado del tope en minutos (7 días → 168 h). */
const EST_MAX_HOURS = Math.floor(MATRIX_ESTIMATE_MAX_MINUTES / 60)

interface Props {
  item: ContentMatrixItem | null
  topics: MatrixTopic[]
  period: { periodStart: string; periodEnd: string; label: string }
  /** Usuarios internos que se pueden asignar a la pieza. */
  assignableUsers: Array<{ id: string; full_name: string }>
  /** Matriz cerrada: todo queda de solo lectura. (Una pieza convertida congela solo algunos campos.) */
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

/** Campos con borrador local mientras se editan (textos, fecha y las dos mitades del estimado). */
type Drafts = Partial<Record<ItemTextKey | 'deadline' | 'estHours' | 'estMins', string>>

function withoutKeys(d: Drafts, keys: readonly (keyof Drafts)[]): Drafts {
  const next = { ...d }
  for (const k of keys) delete next[k]
  return next
}

function ItemSheet({ item, topics, period, assignableUsers, readOnly, error, failedDrafts, onClose, onPatch }: Omit<Props, 'item'> & { item: ContentMatrixItem }) {
  // Borradores solo de los campos que se están editando. Al perder foco se guardan y se descartan; lo mostrado
  // sale entonces del texto fallido (si el último guardado de ese campo falló) o de `item` (optimista o confirmado).
  const [drafts, setDrafts] = useState<Drafts>({})
  const [dateError, setDateError] = useState<string | null>(null)

  // Bloqueo por campo: una matriz cerrada congela todo; una pieza ya convertida congela SOLO lo que se
  // copió al requerimiento (título, tipo, fecha, responsable y estimado — `updateItem` rechaza esos cinco),
  // porque editarlo aquí dejaría la tarjeta del pipeline divergida sin que nada lo indique. El resto del
  // brief (tema, objetivo, copy, guion, estilo visual, hashtags, CTA) lo lee el requerimiento de la pieza,
  // así que sigue editable.
  const converted = item.status === 'converted'
  const frozen = readOnly || converted

  const rangeLabel = `${formatDeadlineDate(period.periodStart)} y ${formatDeadlineDate(period.periodEnd)}`
  const savedText = (key: ItemTextKey): string => (key === 'title' ? item.title : item[key] ?? '')
  const shownText = (key: ItemTextKey): string => drafts[key] ?? failedDrafts?.[key] ?? savedText(key)
  const validDeadline = (d: string) => isIsoDate(d) && d >= period.periodStart && d <= period.periodEnd

  const assigned = item.assigned_to ?? []
  const atAssigneeCap = assigned.length >= MATRIX_MAX_ASSIGNEES

  // El estimado se lleva en `drafts` como la fecha (y no en un estado aparte): si el guardado falla y el
  // editor revierte `item`, al soltar el borrador los inputs vuelven a mostrar el valor confirmado en vez
  // de quedarse enseñando un número que no se guardó.
  const savedEstimate = splitEstimate(item.estimated_time_minutes)
  const shownEstHours = drafts.estHours ?? savedEstimate.hours
  const shownEstMins = drafts.estMins ?? savedEstimate.mins

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

  /**
   * Horas + minutos → minutos totales (recortados a los topes). `undefined` si no hay borrador del
   * estimado o si el total coincide con lo ya guardado; `null` si el usuario lo dejó en blanco.
   */
  function pendingEstimate(): number | null | undefined {
    if (drafts.estHours === undefined && drafts.estMins === undefined) return undefined
    const h = clampInt(shownEstHours, 0, EST_MAX_HOURS)
    const m = clampInt(shownEstMins, 0, 59)
    const total = Math.min(h * 60 + m, MATRIX_ESTIMATE_MAX_MINUTES)
    const value = total > 0 ? total : null
    return value === (item.estimated_time_minutes ?? null) ? undefined : value
  }

  function commitEstimate() {
    const value = pendingEstimate()
    setDrafts((d) => withoutKeys(d, ['estHours', 'estMins']))
    // `null` es un valor válido (borrar el estimado): solo `undefined` significa "nada que guardar".
    if (value !== undefined) onPatch({ estimated_time_minutes: value })
  }

  function toggleAssignee(userId: string) {
    const next = assigned.includes(userId) ? assigned.filter((id) => id !== userId) : [...assigned, userId]
    if (next.length > MATRIX_MAX_ASSIGNEES) return
    onPatch({ assigned_to: next })
  }

  /** Cerrar con Escape o clic fuera no dispara el blur del campo activo: se guarda lo pendiente aquí. */
  function close() {
    const patch = pendingTextPatch(ITEM_TEXT_KEYS)
    if (drafts.deadline !== undefined && validDeadline(drafts.deadline) && drafts.deadline !== item.deadline) {
      patch.deadline = drafts.deadline
    }
    const estimate = pendingEstimate()
    if (estimate !== undefined) patch.estimated_time_minutes = estimate
    if (Object.keys(patch).length > 0) onPatch(patch)
    onClose()
  }

  const text = (key: ItemTextKey, label: string, rows?: number, placeholder?: string) => {
    const id = `matrix-item-${key}`
    const failed = failedDrafts?.[key]
    const common = {
      id,
      value: shownText(key),
      // El título es lo único de este bloque que además se congela al convertir (se copió al requerimiento).
      disabled: key === 'title' ? frozen : readOnly,
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
            Período {period.label}{readOnly ? ' · solo lectura' : converted ? ' · convertida' : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && (
            <p role="alert" className="text-xs text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">{error}</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="matrix-item-type" className={labelCls}>Tipo</label>
              <select id="matrix-item-type" value={item.content_type} disabled={frozen} className={inputCls}
                onChange={(e) => onPatch({ content_type: e.target.value as ContentType })}>
                {MATRIX_CONTENT_TYPES.map((t) => <option key={t} value={t}>{CONTENT_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="matrix-item-deadline" className={labelCls}>Entrega</label>
              <input id="matrix-item-deadline" type="date" value={drafts.deadline ?? item.deadline}
                min={period.periodStart} max={period.periodEnd} disabled={frozen} className={inputCls}
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
          {/* -mt-2: este párrafo se apoya en el grid de arriba. No insertar campos entre ambos. */}
          <p id="matrix-item-deadline-hint" className={`-mt-2 text-[11px] ${dateError ? 'text-fm-error' : 'text-fm-on-surface-variant'}`}>
            {dateError ?? `Entrega entre ${rangeLabel}.`}
          </p>

          <div>
            <span id="matrix-item-assignees-label" className={labelCls}>Responsable *</span>
            {/* Grupo con nombre: sin él, un lector de pantalla anuncia cada casilla suelta, sin decir de qué lista es. */}
            <div role="group" aria-labelledby="matrix-item-assignees-label"
              aria-describedby={atAssigneeCap ? 'matrix-item-assignees-cap' : undefined}
              className="bg-fm-background border border-fm-surface-container-high rounded-xl px-3 py-2 space-y-1.5 max-h-32 overflow-y-auto">
              {assignableUsers.length === 0 ? (
                <p className="text-[11px] text-fm-on-surface-variant">No hay usuarios asignables.</p>
              ) : assignableUsers.map((u) => {
                const checked = assigned.includes(u.id)
                return (
                  <label key={u.id} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={checked} disabled={frozen || (!checked && atAssigneeCap)}
                      className="rounded accent-fm-primary"
                      onChange={() => toggleAssignee(u.id)} />
                    <span className="text-sm text-fm-on-surface">{u.full_name}</span>
                  </label>
                )
              })}
            </div>
            {atAssigneeCap && (
              <p id="matrix-item-assignees-cap" className="mt-1 text-[11px] text-fm-on-surface-variant">
                Máximo {MATRIX_MAX_ASSIGNEES} responsables por pieza: quita uno para poder agregar otro.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="matrix-item-est-h" className={labelCls}>Horas *</label>
              <input id="matrix-item-est-h" type="number" min="0" max={EST_MAX_HOURS} value={shownEstHours} disabled={frozen} className={inputCls}
                onChange={(e) => { const v = e.target.value; setDrafts((d) => ({ ...d, estHours: v })) }} onBlur={commitEstimate} />
            </div>
            <div>
              <label htmlFor="matrix-item-est-m" className={labelCls}>Minutos *</label>
              <input id="matrix-item-est-m" type="number" min="0" max="59" value={shownEstMins} disabled={frozen} className={inputCls}
                onChange={(e) => { const v = e.target.value; setDrafts((d) => ({ ...d, estMins: v })) }} onBlur={commitEstimate} />
            </div>
          </div>

          {converted && (
            <p className="text-[11px] text-fm-on-surface-variant">
              Ya convertida: el título, el tipo, la fecha, el responsable y el estimado se editan en el requerimiento.
            </p>
          )}

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

/** Minutos totales → texto de los dos inputs. `null`/0 → ambos vacíos (nada escrito todavía). */
function splitEstimate(total: number | null): { hours: string; mins: string } {
  if (!total || total <= 0) return { hours: '', mins: '' }
  return { hours: String(Math.floor(total / 60)), mins: String(total % 60) }
}

/** Texto de un input numérico → entero dentro del rango (vacío o basura → `min`). */
function clampInt(raw: string, min: number, max: number): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}
