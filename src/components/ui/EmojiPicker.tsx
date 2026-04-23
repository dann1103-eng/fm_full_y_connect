'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { SmileIcon } from 'lucide-react'
import { EMOJIS, EMOJI_CATEGORIES, type EmojiCategory } from '@/lib/data/emojis'

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  /** Positional alignment relative to the trigger button. Default: 'top-right' (panel opens above, aligned to the right edge of the button). */
  align?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
  triggerClassName?: string
}

export function EmojiPicker({ onSelect, align = 'top-right', triggerClassName }: EmojiPickerProps) {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<EmojiCategory>('people')
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q) return EMOJIS.filter(e => e.name.includes(q))
    return EMOJIS.filter(e => e.category === category)
  }, [query, category])

  const panelPos =
    align === 'top-right' ? 'bottom-full right-0 mb-2'
      : align === 'top-left' ? 'bottom-full left-0 mb-2'
      : align === 'bottom-right' ? 'top-full right-0 mt-2'
      : 'top-full left-0 mt-2'

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        aria-label="Insertar emoji"
        onClick={() => setOpen(v => !v)}
        className={triggerClassName ?? 'p-1.5 rounded-lg text-fm-outline hover:text-fm-primary hover:bg-fm-surface-container transition-colors'}
      >
        <SmileIcon size={18} />
      </button>
      {open && (
        <div
          className={`absolute ${panelPos} z-50 w-[320px] bg-fm-surface-container-lowest rounded-xl shadow-xl ring-1 ring-black/10 overflow-hidden`}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="p-2 border-b border-fm-surface-container-low">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar emoji…"
              className="w-full px-2.5 py-1.5 text-xs rounded-md bg-fm-surface-container-low focus:outline-none focus:ring-1 focus:ring-fm-primary"
            />
          </div>
          {!query && (
            <div className="flex items-center gap-0.5 px-1.5 pt-1.5">
              {EMOJI_CATEGORIES.map(c => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCategory(c.key)}
                  aria-label={c.label}
                  className={`flex-1 py-1.5 rounded-md text-base transition-colors ${
                    category === c.key
                      ? 'bg-fm-primary-container text-fm-primary'
                      : 'hover:bg-fm-surface-container-low'
                  }`}
                >
                  {c.icon}
                </button>
              ))}
            </div>
          )}
          <div className="max-h-56 overflow-y-auto p-1.5">
            {visible.length === 0 ? (
              <p className="text-center text-xs text-fm-outline py-6">Sin resultados</p>
            ) : (
              <div className="grid grid-cols-8 gap-0.5">
                {visible.map(e => (
                  <button
                    key={e.char}
                    type="button"
                    title={e.name}
                    onClick={() => {
                      onSelect(e.char)
                      setOpen(false)
                    }}
                    className="text-lg leading-none p-1.5 rounded hover:bg-fm-surface-container-low transition-colors"
                  >
                    {e.char}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Helper: insert text at a textarea's cursor, updating both DOM and state. */
export function insertAtCursor(
  textarea: HTMLTextAreaElement | null,
  current: string,
  text: string
): { next: string; caret: number } {
  if (!textarea) {
    return { next: current + text, caret: current.length + text.length }
  }
  const start = textarea.selectionStart ?? current.length
  const end = textarea.selectionEnd ?? current.length
  const next = current.slice(0, start) + text + current.slice(end)
  return { next, caret: start + text.length }
}
