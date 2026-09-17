'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import type { ContentMatrix, ContentType, MatrixStatus, Requirement } from '@/types/db'
import {
  APPROVAL_PROBLEM_LABELS, MATRIX_TEXT_LIMITS,
  type ApprovalProblem, type ApprovalProblemReason, type MatrixUsage,
} from '@/lib/domain/matrix'
import { MatrixChips } from './MatrixChips'
import { StatusBadge } from './StatusBadge'

export type SaveState = 'saving' | 'saved' | 'unsaved'

function saveLabel(state: SaveState, unsavedCount: number): string {
  if (state === 'saving') return 'Guardando…'
  if (state === 'unsaved') return `${unsavedCount} cambio${unsavedCount !== 1 ? 's' : ''} sin guardar`
  return 'Guardado'
}

interface Props {
  matrix: ContentMatrix
  client: { id: string; name: string; logo_url: string | null }
  periodLabel: string
  usage: MatrixUsage
  estimated: boolean
  saveState: SaveState
  /** Campos de texto cuyo guardado falló y siguen pendientes. */
  unsavedCount: number
  /** Hay una acción estructural en curso (estado, borrar, vínculo, duplicar): evita el doble clic. */
  busy: boolean
  /** Hay una pieza agregándose: los chips no crean otra mientras tanto. */
  adding: boolean
  linked: Pick<Requirement, 'id' | 'title' | 'phase'> | null
  linkError: string | null
  /** Problemas vigentes tras un intento fallido de aprobar (vacío si no hay que mostrarlos). */
  problems: ApprovalProblem[]
  /** Título cuyo último guardado falló: se sigue mostrando para no perderlo. */
  failedTitle?: string
  onTitle: (title: string) => void
  onAdd: (type: ContentType) => void
  onStatus: (to: MatrixStatus) => void
  onDuplicate: () => void
  onDelete: () => void
  onRetryLink: () => void
}

function problemsSummary(problems: ApprovalProblem[]): string {
  const counts = new Map<ApprovalProblemReason, number>()
  for (const p of problems) counts.set(p.reason, (counts.get(p.reason) ?? 0) + 1)
  return [...counts.entries()].map(([reason, n]) => `${APPROVAL_PROBLEM_LABELS[reason].toLowerCase()} (${n})`).join(', ')
}

export function MatrixHeader(p: Props) {
  // Borrador del título solo mientras se edita: al perder foco se guarda y se descarta. Lo mostrado sale
  // después de `failedTitle` (si el guardado falló) o de `matrix.title` (confirmado u optimista).
  const [draftTitle, setDraftTitle] = useState<string | null>(null)
  const readOnly = p.matrix.status === 'closed'
  const btn = 'px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors disabled:opacity-50'

  function commitTitle() {
    if (draftTitle === null) return
    const t = draftTitle.trim()
    setDraftTitle(null)
    // Vacío: se descarta (el título es obligatorio). Con un fallo previo se reintenta aunque coincida.
    if (t && (t !== p.matrix.title || p.failedTitle !== undefined)) p.onTitle(t)
  }

  return (
    <section className="glass-panel rounded-2xl p-4 sm:p-5 space-y-4">
      <div className="flex items-start gap-3">
        {p.client.logo_url
          ? <Image src={p.client.logo_url} alt="" width={40} height={40} unoptimized className="h-10 w-10 flex-shrink-0 rounded-full object-cover" />
          : <span aria-hidden="true" className="h-10 w-10 flex-shrink-0 rounded-full bg-fm-primary/15 text-fm-primary font-bold flex items-center justify-center">{p.client.name.slice(0, 1).toUpperCase()}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-x-2 gap-y-1 flex-wrap">
            <Link href={`/clients/${p.client.id}`} className="text-sm font-semibold text-fm-on-surface hover:underline">{p.client.name}</Link>
            <span className="text-xs text-fm-on-surface-variant">· {p.periodLabel}</span>
            <StatusBadge status={p.matrix.status} />
            <span role="status" className={`text-[11px] ml-auto ${p.saveState === 'unsaved' ? 'text-fm-error font-semibold' : 'text-fm-on-surface-variant'}`}>
              {saveLabel(p.saveState, p.unsavedCount)}
            </span>
          </div>
          <input
            value={draftTitle ?? p.failedTitle ?? p.matrix.title}
            disabled={readOnly}
            maxLength={MATRIX_TEXT_LIMITS.title}
            onChange={(e) => setDraftTitle(e.target.value)}
            // Con texto fallido pendiente, enfocar lo carga como borrador: al salir del campo se reintenta.
            onFocus={() => { if (draftTitle === null && p.failedTitle !== undefined) setDraftTitle(p.failedTitle) }}
            onBlur={commitTitle}
            aria-invalid={p.failedTitle !== undefined || undefined}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className={`mt-1 w-full bg-transparent text-lg sm:text-xl font-bold text-fm-on-surface outline-none border-b disabled:opacity-100 ${
              p.failedTitle !== undefined ? 'border-fm-error/60' : 'border-transparent focus:border-fm-primary'
            }`}
            aria-label="Título de la matriz"
          />
        </div>
      </div>

      <MatrixChips usage={p.usage} estimated={p.estimated} onAdd={readOnly ? undefined : p.onAdd} disabled={p.adding} />

      {!p.matrix.matrix_requirement_id && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">warning</span>
          <span className="min-w-0 flex-1">No se registró el requerimiento de matriz en el ciclo vigente{p.linkError ? `: ${p.linkError}` : '.'}</span>
          {!readOnly && (
            <button type="button" onClick={p.onRetryLink} disabled={p.busy} className="font-semibold underline disabled:opacity-50">Reintentar</button>
          )}
        </div>
      )}
      {p.linked && (
        <p className="text-[11px] text-fm-on-surface-variant">
          Requerimiento de matriz vinculado: <span className="font-medium text-fm-on-surface">{p.linked.title || 'Matriz de contenido'}</span>
        </p>
      )}

      {p.problems.length > 0 && (
        <p className="text-xs text-fm-error">
          Hay {p.problems.length} pieza{p.problems.length !== 1 && 's'} incompleta{p.problems.length !== 1 && 's'} (resaltada{p.problems.length !== 1 && 's'} en la tabla): {problemsSummary(p.problems)}. Corrígelas para aprobar.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {p.matrix.status === 'draft' && (
          <button type="button" onClick={() => p.onStatus('approved')} disabled={p.busy}
            className={`${btn} bg-fm-primary text-white border-fm-primary hover:bg-fm-primary-dim`}>Aprobar matriz</button>
        )}
        {p.matrix.status === 'approved' && (
          <button type="button" onClick={() => p.onStatus('draft')} disabled={p.busy}
            className={`${btn} border-fm-outline-variant text-fm-on-surface hover:bg-fm-surface-container-low`}>Volver a borrador</button>
        )}
        {!readOnly && (
          <button type="button" disabled={p.busy}
            onClick={() => { if (confirm('¿Cerrar la matriz? Quedará en solo lectura.')) p.onStatus('closed') }}
            className={`${btn} border-fm-outline-variant text-fm-on-surface hover:bg-fm-surface-container-low`}>Cerrar matriz</button>
        )}
        <button type="button" onClick={p.onDuplicate} disabled={p.busy}
          className={`${btn} border-fm-outline-variant text-fm-on-surface hover:bg-fm-surface-container-low`}>Duplicar</button>
        {p.matrix.status === 'draft' && (
          <button type="button" onClick={p.onDelete} disabled={p.busy}
            className={`${btn} border-fm-error/40 text-fm-error hover:bg-fm-error/5 ml-auto`}>Eliminar</button>
        )}
      </div>
    </section>
  )
}
