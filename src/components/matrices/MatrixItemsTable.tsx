'use client'

import type { ContentMatrixItem, ContentType } from '@/types/db'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import { CONTENT_ICONS } from '@/lib/domain/content-icons'
import { formatDeadlineBadge } from '@/lib/domain/deadline'
import {
  APPROVAL_PROBLEM_LABELS, MATRIX_CONTENT_TYPES, MATRIX_OBJECTIVE_LABELS,
  type ApprovalProblem, type ApprovalProblemReason, type MatrixUsage,
} from '@/lib/domain/matrix'
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

export function TypeBadge({ type }: { type: ContentType }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TYPE_CLASS[type] ?? 'bg-fm-surface-container-high text-fm-on-surface'}`}>
      <span className="material-symbols-outlined text-[13px]" aria-hidden="true">{CONTENT_ICONS[type]}</span>
      {CONTENT_TYPE_LABELS[type]}
    </span>
  )
}

interface Props {
  items: ContentMatrixItem[]
  usage: MatrixUsage
  problems: ApprovalProblem[]
  selectedId: string | null
  readOnly: boolean
  /** Hay una pieza agregándose o duplicándose: no se ofrece crear otra hasta que termine. */
  adding: boolean
  /** Piezas con texto cuyo guardado falló y sigue pendiente. */
  unsavedIds: string[]
  onSelect: (id: string) => void
  onAdd: (type: ContentType) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
}

export function MatrixItemsTable({ items, usage, problems, selectedId, readOnly, adding, unsavedIds, onSelect, onAdd, onDuplicate, onDelete }: Props) {
  const over = new Set(usage.overPlanItemIds)
  const unsaved = new Set(unsavedIds)
  const problemById = new Map<string, ApprovalProblemReason>(problems.map((p) => [p.itemId, p.reason]))
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
        {unsaved.has(it.id) && <span className="rounded-full bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200 px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap">Sin guardar</span>}
        {over.has(it.id) && <span className="rounded-full bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200 px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap">Fuera de plan</span>}
        {problem && <span className="rounded-full bg-fm-error/10 text-fm-error px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap">{APPROVAL_PROBLEM_LABELS[problem]}</span>}
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
                <button type="button" onClick={() => onSelect(it.id)} className="min-w-0 flex-1 text-left p-3 space-y-1.5">
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
                {!readOnly && <span className="pt-2 pr-2">{rowActions(it)}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
