'use client'

import { useState } from 'react'
import type { MatrixTopic } from '@/types/db'
import { MAX_TOPICS, sanitizeTopics } from '@/lib/domain/matrix'

interface Props {
  topics: MatrixTopic[]
  onChange: (topics: MatrixTopic[]) => void
  /** Devuelve cuántas piezas usan el tema; si > 0 se pide confirmación antes de quitarlo. */
  usageCount?: (name: string) => number
  disabled?: boolean
}

export function TopicsInput({ topics, onChange, usageCount, disabled }: Props) {
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
            <button type="button" onClick={() => remove(t.name)} aria-label={`Quitar tema ${t.name}`}
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
          maxLength={60}
          className="min-w-[9rem] flex-1 bg-transparent border-b border-dashed border-fm-outline-variant px-1 py-1 text-xs text-fm-on-surface outline-none focus:border-fm-primary"
        />
      )}
    </div>
  )
}
