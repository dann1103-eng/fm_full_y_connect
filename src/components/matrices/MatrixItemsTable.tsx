'use client'

import Link from 'next/link'
import type { ContentMatrix, ContentMatrixItem, ContentType, MatrixItemStatus } from '@/types/db'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import { CONTENT_ICONS } from '@/lib/domain/content-icons'
import { formatDeadlineBadge } from '@/lib/domain/deadline'
import {
  APPROVAL_PROBLEM_LABELS, convertsBeforePeriodStart, isStalePlanned, MATRIX_CONTENT_TYPES,
  MATRIX_ITEM_STATUS_LABELS, MATRIX_OBJECTIVE_LABELS,
  type ApprovalProblem, type ApprovalProblemReason, type MatrixUsage,
} from '@/lib/domain/matrix'
import type { DateString } from '@/lib/domain/dates'
import { failedItemLabel, isUnwrittenItem, type FailedItem } from '@/lib/domain/matrix-generation'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const TYPE_CLASS: Partial<Record<ContentType, string>> = {
  historia: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  estatico: 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200',
  video_corto: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200',
  reel: 'bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200',
  short: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200',
}

const ITEM_STATUS_CLASS: Record<MatrixItemStatus, string> = {
  planned: 'bg-fm-surface-container-high text-fm-on-surface-variant',
  converted: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-200',
  blocked: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200',
}

/** Motivo de bloqueo recortado para la tabla; el texto completo va en el `title`. */
const REASON_MAX = 80

function shortReason(reason: string): string {
  return reason.length > REASON_MAX ? `${reason.slice(0, REASON_MAX - 1)}…` : reason
}

export function TypeBadge({ type }: { type: ContentType }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TYPE_CLASS[type] ?? 'bg-fm-surface-container-high text-fm-on-surface'}`}>
      <span className="material-symbols-outlined text-[13px]" aria-hidden="true">{CONTENT_ICONS[type]}</span>
      {CONTENT_TYPE_LABELS[type]}
    </span>
  )
}

function ItemStatusBadge({ status }: { status: MatrixItemStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${ITEM_STATUS_CLASS[status]}`}>
      {MATRIX_ITEM_STATUS_LABELS[status]}
    </span>
  )
}

interface Props {
  items: ContentMatrixItem[]
  /** La matriz: `lead_days` + `period_start` deciden el aviso de ciclo por pieza. */
  matrix: ContentMatrix
  usage: MatrixUsage
  problems: ApprovalProblem[]
  selectedId: string | null
  readOnly: boolean
  /** Hay una pieza agregándose o duplicándose: no se ofrece crear otra hasta que termine. */
  adding: boolean
  /** Piezas con texto cuyo guardado falló y sigue pendiente. */
  unsavedIds: string[]
  /** Piezas convertidas cuyo requerimiento fue anulado o borrado: se ofrece replanificar. */
  linkedVoidedItemIds: string[]
  /** Pieza con una conversión o replanificación en curso: sus botones quedan bloqueados. */
  busyItemId: string | null
  /** Hoy en GMT-6, del servidor: decide qué piezas planificadas ya se le escaparon al barrido. */
  today: DateString
  onSelect: (id: string) => void
  onAdd: (type: ContentType) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onConvertNow: (id: string) => void
  onReplan: (id: string) => void
  /**
   * El cliente tiene perfil de marca usable: se ofrece "Sin redactar" + "Regenerar". Sin perfil no se
   * muestra por fila (el motivo ya está una vez, junto a "Generar con IA", y una matriz manual no se
   * llenaría de avisos de algo que no se puede usar).
   */
  aiAvailable: boolean
  /** Piezas con un hijo de IA vivo. */
  writingItemIds: string[]
  /** Piezas cuyo último hijo no dejó texto y que vale la pena señalar (el editor ya filtró). */
  failedItems: FailedItem[]
  /** Piezas con la acción "Regenerar" encolándose: evita el doble clic. */
  regeneratingIds: string[]
  onRegenerate: (id: string) => void
}

export function MatrixItemsTable({
  items, matrix, usage, problems, selectedId, readOnly, adding, unsavedIds, linkedVoidedItemIds, busyItemId, today,
  onSelect, onAdd, onDuplicate, onDelete, onConvertNow, onReplan,
  aiAvailable, writingItemIds, failedItems, regeneratingIds, onRegenerate,
}: Props) {
  const over = new Set(usage.overPlanItemIds)
  const unsaved = new Set(unsavedIds)
  const voided = new Set(linkedVoidedItemIds)
  const problemById = new Map<string, ApprovalProblemReason>(problems.map((p) => [p.itemId, p.reason]))
  const writing = new Set(writingItemIds)
  const failedById = new Map(failedItems.map((f) => [f.itemId, f]))
  const regenerating = new Set(regeneratingIds)
  const inactive = MATRIX_CONTENT_TYPES.filter((t) => !usage.activeTypes.includes(t))

  // Menú y no <select>: con un select, recorrer las opciones con las flechas dispararía onChange y crearía
  // piezas. Los ítems del menú solo actúan con clic, Enter o Espacio.
  const addMenu = !readOnly && (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={adding}
        className="inline-flex items-center gap-1 rounded-xl border border-fm-surface-container-high bg-fm-background px-3 py-1.5 text-sm font-medium text-fm-on-surface hover:bg-fm-surface-container-low disabled:opacity-50">
        {adding ? 'Agregando…' : '+ Agregar pieza'}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-60">
        {usage.activeTypes.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Con cupo</DropdownMenuLabel>
            {usage.activeTypes.map((t) => (
              <DropdownMenuItem key={t} onClick={() => onAdd(t)}>
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{CONTENT_ICONS[t]}</span>
                {CONTENT_TYPE_LABELS[t]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
        {usage.activeTypes.length > 0 && inactive.length > 0 && <DropdownMenuSeparator />}
        {inactive.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Sin cupo (quedará fuera de plan)</DropdownMenuLabel>
            {inactive.map((t) => (
              <DropdownMenuItem key={t} onClick={() => onAdd(t)}>
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{CONTENT_ICONS[t]}</span>
                {CONTENT_TYPE_LABELS[t]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const rowActions = (it: ContentMatrixItem) => !readOnly && (
    <span className="inline-flex items-center gap-1">
      <button type="button" onClick={(e) => { e.stopPropagation(); onDuplicate(it.id) }} disabled={adding}
        title="Duplicar pieza" aria-label={`Duplicar pieza: ${it.title || 'sin título'}`}
        className="material-symbols-outlined text-[18px] p-1 rounded-md text-fm-on-surface-variant hover:text-fm-primary disabled:opacity-50">content_copy</button>
      <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(it.id) }}
        title="Eliminar pieza" aria-label={`Eliminar pieza: ${it.title || 'sin título'}`}
        className="material-symbols-outlined text-[18px] p-1 rounded-md text-fm-on-surface-variant hover:text-fm-error">delete</button>
    </span>
  )

  const flags = (it: ContentMatrixItem) => {
    const problem = problemById.get(it.id)
    return (
      <span className="flex flex-wrap items-center gap-1">
        {it.needs_production && (
          <span role="img" aria-label="Necesita producción" title="Necesita producción" className="material-symbols-outlined text-[16px] text-fm-primary">videocam</span>
        )}
        {/* En una convertida ya no aplica: el aviso está en futuro y la conversión ya ocurrió. */}
        {it.status !== 'converted' && convertsBeforePeriodStart(it, matrix) && (
          <span role="img" aria-label="Se convertirá antes de que inicie el período"
            title="Se convertirá antes de que inicie el período: consumirá el cupo del ciclo anterior."
            className="material-symbols-outlined text-[16px] text-amber-600 dark:text-amber-300">schedule</span>
        )}
        {unsaved.has(it.id) && <span className="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200 px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap">Sin guardar</span>}
        {/* En una pieza convertida el aviso de cupo ya no se puede accionar (el requerimiento existe): se omite. */}
        {over.has(it.id) && it.status !== 'converted' && <span className="rounded-full bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200 px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap">Fuera de plan</span>}
        {problem && <span className="rounded-full bg-fm-error/10 text-fm-error px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap">{APPROVAL_PROBLEM_LABELS[problem]}</span>}
      </span>
    )
  }

  const linkCls = 'text-[11px] font-semibold text-fm-primary underline whitespace-nowrap'
  const actionCls = 'text-[11px] font-semibold text-fm-primary underline whitespace-nowrap disabled:opacity-50 disabled:no-underline'

  // Hay una conversión o replanificación en curso (la de esta fila o la de otra): se deshabilitan TODAS
  // las acciones de conversión. `MatrixEditor` ignora un segundo clic mientras corre la primera, y un
  // botón que no hace nada al pulsarlo confunde más que uno deshabilitado.
  const anyBusy = busyItemId !== null

  /** Estado de conversión: distintivo + lo accionable (enlace, motivo, botones). */
  const conversion = (it: ContentMatrixItem) => {
    const busy = busyItemId === it.id
    const isVoided = it.status === 'converted' && voided.has(it.id)
    return (
      <span className="flex flex-col items-start gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <ItemStatusBadge status={it.status} />
          {it.status === 'converted' && it.requirement_id && !isVoided && (
            <Link href={`/pipeline?req=${it.requirement_id}`} onClick={(e) => e.stopPropagation()} className={linkCls}>
              Ver requerimiento
            </Link>
          )}
          {/*
            Bloqueada: el barrido ya no la vuelve a mirar, el reintento es manual.
            Planificada y vencida hace más de CATCHUP_DAYS: el barrido tampoco la recogerá nunca
            (matriz aprobada tarde, o pieza replanificada cuando su fecha ya pasó). Sin este botón
            queda muerta en la tabla. Las planificadas dentro de la ventana NO lo llevan: el barrido
            se encarga y un clic de más convertiría antes de tiempo, consumiendo cupo.
          */}
          {!readOnly && (it.status === 'blocked' || (isStalePlanned(it, today) && matrix.status === 'approved')) && (
            <button type="button" disabled={anyBusy} className={actionCls}
              onClick={(e) => { e.stopPropagation(); onConvertNow(it.id) }}>
              {busy ? 'Convirtiendo…' : 'Convertir ahora'}
            </button>
          )}
        </span>
        {it.status === 'blocked' && it.blocked_reason && (
          // El `title` solo lo ve el ratón: el texto completo se repite oculto para lectores de pantalla.
          <span className="block max-w-[16rem] text-[11px] text-fm-error">
            <span aria-hidden="true" title={it.blocked_reason} className="block truncate">{shortReason(it.blocked_reason)}</span>
            <span className="sr-only">Motivo del bloqueo: {it.blocked_reason}</span>
          </span>
        )}
        {isVoided && (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-amber-700 dark:text-amber-300">Requerimiento anulado</span>
            <button type="button" disabled={anyBusy} className={actionCls}
              onClick={(e) => { e.stopPropagation(); onReplan(it.id) }}>
              {busy ? 'Replanificando…' : 'Volver a planificar (se convertirá de nuevo)'}
            </button>
          </span>
        )}
      </span>
    )
  }

  /**
   * Estado de la redacción con IA: "Redactando…" mientras haya un hijo vivo; si el último no dejó texto,
   * el motivo; si nunca se redactó, "Sin redactar". Los dos últimos con "Regenerar" al lado.
   */
  const aiState = (it: ContentMatrixItem) => {
    if (writing.has(it.id)) {
      // Sin `role="status"`: con 15 piezas serían 15 regiones vivas. El avance agregado lo anuncia la franja.
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-fm-primary/10 text-fm-primary px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap">
          <span className="material-symbols-outlined text-[12px] animate-spin" aria-hidden="true">progress_activity</span>
          Redactando…
        </span>
      )
    }
    if (readOnly || !aiAvailable) return null
    const failure = failedById.get(it.id)
    if (!failure && !isUnwrittenItem(it)) return null
    const queued = regenerating.has(it.id)
    const label = failure ? failedItemLabel(failure) : null
    return (
      <span className="flex flex-col items-start gap-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
            failure ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200' : 'bg-fm-surface-container-high text-fm-on-surface-variant'
          }`}>
            {failure ? 'No se pudo redactar' : 'Sin redactar'}
          </span>
          <button type="button" disabled={queued} className={actionCls}
            aria-label={`Regenerar con IA: ${it.title || 'pieza sin título'}`}
            onClick={(e) => { e.stopPropagation(); onRegenerate(it.id) }}>
            {queued ? 'Encolando…' : 'Regenerar'}
          </button>
        </span>
        {label && (
          // El detalle técnico de un job fallido (a veces en inglés, del SDK) solo va en el `title`.
          <span className="block max-w-[16rem] text-[11px] text-fm-error" title={failure?.error ?? undefined}>{label}</span>
        )}
      </span>
    )
  }

  const untitled = <span className="italic text-fm-on-surface-variant">Sin título</span>

  return (
    <section className="glass-panel rounded-2xl p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-fm-on-surface">Piezas del mes <span className="text-fm-on-surface-variant font-normal">· {items.length}</span></h2>
        {addMenu}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-fm-on-surface-variant py-10 text-center">
          {readOnly ? 'La matriz no tiene piezas.' : 'Aún no hay piezas. Haz clic en un chip de cupo o en "Agregar pieza".'}
        </p>
      ) : (
        <>
          {/* Escritorio: tabla. El clic en la fila es un atajo de ratón; el botón del título es el acceso por teclado. */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-fm-on-surface-variant border-b border-fm-surface-container-high">
                  <th className="py-2 pr-3">Entrega</th>
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3">Tema</th>
                  <th className="py-2 pr-3">Título</th>
                  <th className="py-2 pr-3 hidden lg:table-cell">Objetivo</th>
                  <th className="py-2 pr-3">Estado</th>
                  <th className="py-2 pr-3"><span className="sr-only">Avisos</span></th>
                  <th className="py-2"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} onClick={() => onSelect(it.id)}
                    className={`border-b border-fm-surface-container-high/60 cursor-pointer ${
                      problemById.has(it.id) ? 'bg-fm-error/5 hover:bg-fm-error/10'
                        : selectedId === it.id ? 'bg-fm-primary/5' : 'hover:bg-fm-surface-container-low'
                    }`}>
                    <td className="py-2.5 pr-3 whitespace-nowrap tabular-nums text-fm-on-surface">{formatDeadlineBadge(it.deadline)}</td>
                    <td className="py-2.5 pr-3"><TypeBadge type={it.content_type} /></td>
                    <td className="py-2.5 pr-3 text-fm-on-surface-variant truncate max-w-[10rem]">{it.topic ?? '—'}</td>
                    <td className="py-2.5 pr-3 text-fm-on-surface max-w-[20rem]">
                      <button type="button" onClick={(e) => { e.stopPropagation(); onSelect(it.id) }}
                        aria-label={`Editar pieza: ${it.title || 'sin título'}`}
                        className="block w-full truncate text-left rounded hover:underline focus-visible:underline">
                        {it.title || untitled}
                      </button>
                    </td>
                    <td className="py-2.5 pr-3 hidden lg:table-cell text-fm-on-surface-variant">{it.objective ? MATRIX_OBJECTIVE_LABELS[it.objective] : '—'}</td>
                    <td className="py-2.5 pr-3">
                      <span className="flex flex-col items-start gap-1">{conversion(it)}{aiState(it)}</span>
                    </td>
                    <td className="py-2.5 pr-3">{flags(it)}</td>
                    <td className="py-2.5 text-right whitespace-nowrap">{rowActions(it)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Móvil: tarjetas. El área principal es un botón; las acciones son botones hermanos, no anidados. */}
          <div className="sm:hidden space-y-2">
            {items.map((it) => (
              <div key={it.id}
                className={`flex items-start gap-1 rounded-xl border ${
                  problemById.has(it.id) ? 'border-fm-error/40 bg-fm-error/5'
                    : selectedId === it.id ? 'border-fm-primary bg-fm-primary/5' : 'border-fm-surface-container-high'
                }`}>
                <div className="min-w-0 flex-1 p-3 space-y-1.5">
                  <button type="button" onClick={() => onSelect(it.id)} className="block w-full text-left space-y-1.5">
                    <span className="flex items-center gap-2">
                      <span className="text-xs tabular-nums text-fm-on-surface-variant">{formatDeadlineBadge(it.deadline)}</span>
                      <TypeBadge type={it.content_type} />
                    </span>
                    <span className="block text-sm text-fm-on-surface">{it.title || untitled}</span>
                    <span className="flex items-center justify-between gap-2 text-[11px] text-fm-on-surface-variant">
                      <span className="min-w-0 truncate">{it.topic ?? '—'}{it.objective ? ` · ${MATRIX_OBJECTIVE_LABELS[it.objective]}` : ''}</span>
                      {flags(it)}
                    </span>
                  </button>
                  {/* Fuera del botón: enlace y botones de conversión no pueden anidarse dentro de otro botón. */}
                  {conversion(it)}
                  {aiState(it)}
                </div>
                {!readOnly && <span className="pt-2 pr-2">{rowActions(it)}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
