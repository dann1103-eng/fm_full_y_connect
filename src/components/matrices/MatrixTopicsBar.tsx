'use client'

import { useState } from 'react'
import type { MatrixTopic } from '@/types/db'
import { MATRIX_TEXT_LIMITS } from '@/lib/domain/matrix'
import { TopicsInput } from './TopicsInput'

interface Props {
  topics: MatrixTopic[]
  onChange: (topics: MatrixTopic[]) => void
  /** Devuelve cuántas piezas usan el tema; si > 0 se pide confirmación antes de quitarlo. */
  usageCount: (name: string) => number
  disabled: boolean
  /**
   * Motivo por el que solo los TEMAS no se pueden editar ahora (la IA está planificando), o `null`. Se
   * muestra a la vista; el enfoque del mes sigue editable.
   */
  topicsLockedReason?: string | null
  notes: string | null
  /** Texto de notas cuyo último guardado falló: se sigue mostrando para no perderlo. */
  failedNotes?: string
  onNotesChange: (notes: string | null) => void
}

export function MatrixTopicsBar({ topics, onChange, usageCount, disabled, topicsLockedReason, notes, failedNotes, onNotesChange }: Props) {
  const topicsLocked = !disabled && !!topicsLockedReason
  const [notesOpen, setNotesOpen] = useState(!!notes || failedNotes !== undefined)
  // Borrador solo mientras se edita; al perder foco se guarda y se descarta. Lo mostrado sale después de
  // `failedNotes` (si el guardado falló) o de `notes` (confirmado u optimista).
  const [draftNotes, setDraftNotes] = useState<string | null>(null)

  function commitNotes() {
    if (draftNotes === null) return
    const next = draftNotes.trim() || null
    setDraftNotes(null)
    // Con un fallo previo se reintenta aunque coincida con lo guardado: así se limpia el estado de error.
    if (next !== (notes ?? null) || failedNotes !== undefined) onNotesChange(next)
  }

  return (
    <section className="glass-panel rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span id="matrix-topics-label" className="order-1 text-[11px] uppercase tracking-wider text-fm-on-surface-variant pt-1.5 whitespace-nowrap">Temas del mes</span>
        <div role="group" aria-labelledby="matrix-topics-label" aria-describedby={topicsLocked ? 'matrix-topics-lock' : undefined}
          className="order-3 sm:order-2 basis-full sm:basis-0 sm:flex-1 min-w-0 space-y-1">
          <TopicsInput topics={topics} onChange={onChange} usageCount={usageCount} disabled={disabled || topicsLocked} />
          {topicsLocked && (
            <p id="matrix-topics-lock" className="flex items-center gap-1 text-[11px] text-fm-on-surface-variant">
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">lock</span>
              {topicsLockedReason}
            </p>
          )}
        </div>
        <button type="button" onClick={() => setNotesOpen((v) => !v)} aria-expanded={notesOpen} aria-controls="matrix-notes"
          className="order-2 sm:order-3 ml-auto sm:ml-0 text-[11px] text-fm-primary hover:underline whitespace-nowrap pt-1.5">
          {notesOpen ? 'Ocultar enfoque' : 'Enfoque del mes'}
        </button>
      </div>
      {notesOpen && (
        <textarea
          id="matrix-notes"
          value={draftNotes ?? failedNotes ?? notes ?? ''}
          disabled={disabled}
          maxLength={MATRIX_TEXT_LIMITS.notes}
          onChange={(e) => setDraftNotes(e.target.value)}
          // Con texto fallido pendiente, enfocar lo carga como borrador: al salir del campo se reintenta.
          onFocus={() => { if (draftNotes === null && failedNotes !== undefined) setDraftNotes(failedNotes) }}
          onBlur={commitNotes}
          aria-invalid={failedNotes !== undefined || undefined}
          rows={3}
          aria-label="Enfoque del mes"
          placeholder="Qué quiere comunicar el cliente este mes, apuntes de la reunión…"
          className={`w-full rounded-xl border bg-fm-background px-3 py-2 text-sm text-fm-on-surface disabled:opacity-60 ${
            failedNotes !== undefined ? 'border-fm-error/60' : 'border-fm-surface-container-high'
          }`}
        />
      )}
    </section>
  )
}
