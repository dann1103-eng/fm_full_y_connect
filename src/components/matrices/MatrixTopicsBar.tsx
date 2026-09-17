'use client'

import { useState } from 'react'
import type { MatrixTopic } from '@/types/db'
import { MAX_TOPICS, sanitizeTopics } from '@/lib/domain/matrix'

interface TopicsInputProps {
  topics: MatrixTopic[]
  onChange: (topics: MatrixTopic[]) => void
  /** Devuelve cuántas piezas usan el tema; si > 0 se pide confirmación antes de quitarlo. */
  usageCount?: (name: string) => number
  disabled?: boolean
}

export function TopicsInput({ topics, onChange, usageCount, disabled }: TopicsInputProps) {
  const [draft, setDraft] = useState('')

  function add() {
    const next = sanitizeTopics([...topics, { name: draft }])
    if (next.length !== topics.length) onChange(next)
    setDraft('')
  }

  function remove(name: string) {
    const n = usageCount?.(name) ?? 0
    if (n > 0 && !confirm(`${n} pieza${n !== 1 ? 's usan' : ' usa'} este tema. Se les quitará. ¿Continuar?`)) return
    onChange(topics.filter((t) => t.name !== name))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {topics.map((t) => (
        <span key={t.name} title={t.note}
          className="inline-flex items-center gap-1 rounded-lg bg-fm-primary/10 text-fm-primary px-2.5 py-1 text-xs font-medium">
          {t.name}
          {!disabled && (
            <button type="button" onClick={() => remove(t.name)} aria-label={`Quitar ${t.name}`}
              className="material-symbols-outlined text-[14px] hover:text-fm-error">close</button>
          )}
        </span>
      ))}
      {disabled && topics.length === 0 && (
        <span className="text-xs text-fm-on-surface-variant">Sin temas</span>
      )}
      {!disabled && topics.length < MAX_TOPICS && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          onBlur={() => { if (draft.trim()) add() }}
          placeholder={topics.length === 0 ? 'Tema del mes + Enter' : '+ tema'}
          aria-label="Agregar tema"
          className="min-w-[9rem] flex-1 bg-transparent border-b border-dashed border-fm-outline-variant px-1 py-1 text-xs text-fm-on-surface outline-none focus:border-fm-primary"
        />
      )}
    </div>
  )
}

interface BarProps extends TopicsInputProps {
  notes: string | null
  onNotesChange: (notes: string | null) => void
}

export function MatrixTopicsBar({ notes, onNotesChange, ...inputProps }: BarProps) {
  const [notesOpen, setNotesOpen] = useState(!!notes)
  // Borrador solo mientras se edita; al perder foco se guarda y se descarta, así el texto mostrado
  // vuelve a salir de `notes` (y un error del servidor, que la revierte, se refleja).
  const [draftNotes, setDraftNotes] = useState<string | null>(null)

  function commitNotes() {
    if (draftNotes === null) return
    const next = draftNotes.trim() || null
    setDraftNotes(null)
    if (next !== (notes ?? null)) onNotesChange(next)
  }

  return (
    <section className="glass-panel rounded-2xl p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="order-1 text-[11px] uppercase tracking-wider text-fm-on-surface-variant pt-1.5 whitespace-nowrap">Temas del mes</span>
        <div className="order-3 sm:order-2 basis-full sm:basis-0 sm:flex-1 min-w-0">
          <TopicsInput {...inputProps} />
        </div>
        <button type="button" onClick={() => setNotesOpen((v) => !v)}
          className="order-2 sm:order-3 ml-auto sm:ml-0 text-[11px] text-fm-primary hover:underline whitespace-nowrap pt-1.5">
          {notesOpen ? 'Ocultar enfoque' : 'Enfoque del mes'}
        </button>
      </div>
      {notesOpen && (
        <textarea
          value={draftNotes ?? notes ?? ''}
          disabled={inputProps.disabled}
          onChange={(e) => setDraftNotes(e.target.value)}
          onBlur={commitNotes}
          rows={3}
          aria-label="Enfoque del mes"
          placeholder="Qué quiere comunicar el cliente este mes, apuntes de la reunión…"
          className="w-full rounded-xl border border-fm-surface-container-high bg-fm-background px-3 py-2 text-sm text-fm-on-surface disabled:opacity-60"
        />
      )}
    </section>
  )
}
