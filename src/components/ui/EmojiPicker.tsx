'use client'

import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { SmileIcon } from 'lucide-react'
import { EMOJIS, EMOJI_CATEGORIES, type EmojiCategory } from '@/lib/data/emojis'

interface EmojiPickerProps {
  onSelect: (emoji: string) => void
  /** Positional alignment relative to the trigger button. Default: 'top-right' (panel opens above, aligned to the right edge of the button). */
  align?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
  triggerClassName?: string
}

const PANEL_WIDTH = 300
const PANEL_MAX_HEIGHT = 380
const GAP = 8

export function EmojiPicker({ onSelect, align = 'top-right', triggerClassName }: EmojiPickerProps) {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<EmojiCategory>('people')
  const [query, setQuery] = useState('')
  const [mounted, setMounted] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // SSR-safe portal gate: solo activamos createPortal después del mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  // Calcula la posición del panel relativa al viewport. Se ejecuta al abrir.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const viewportH = window.innerHeight
    const viewportW = window.innerWidth

    let top = 0
    let left = 0

    if (align === 'top-right' || align === 'top-left') {
      // Panel arriba del trigger
      top = rect.top - GAP - PANEL_MAX_HEIGHT
      // Si no entra arriba, voltea abajo
      if (top < GAP) top = rect.bottom + GAP
    } else {
      // Panel abajo del trigger
      top = rect.bottom + GAP
      if (top + PANEL_MAX_HEIGHT > viewportH - GAP) {
        // Si no entra abajo, voltea arriba
        top = rect.top - GAP - PANEL_MAX_HEIGHT
      }
    }

    if (align === 'top-right' || align === 'bottom-right') {
      left = rect.right - PANEL_WIDTH
    } else {
      left = rect.left
    }

    // Clamp dentro del viewport
    if (left < GAP) left = GAP
    if (left + PANEL_WIDTH > viewportW - GAP) left = viewportW - PANEL_WIDTH - GAP
    if (top < GAP) top = GAP

    // Necesitamos medir el DOM post-render del trigger; setState aquí es el
    // patrón estándar para posicionamiento dinámico relativo a un elemento.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCoords({ top, left })
  }, [open, align])

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
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

  const panel = (open && coords) ? (
    <div
      ref={panelRef}
      style={{ position: 'fixed', top: coords.top, left: coords.left, width: PANEL_WIDTH, maxHeight: PANEL_MAX_HEIGHT }}
      className="z-[1000] bg-fm-surface-container-lowest rounded-xl shadow-xl ring-1 ring-black/10 overflow-hidden"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="p-2 border-b border-fm-surface-container-low">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar emoji…"
          className="w-full px-2.5 py-1.5 text-xs rounded-md bg-fm-surface-container-low focus:outline-none focus:ring-1 focus:ring-fm-primary"
          autoFocus
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
          <div className="grid grid-cols-7 gap-0.5">
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
  ) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Insertar emoji"
        onClick={() => setOpen(v => !v)}
        className={triggerClassName ?? 'p-1.5 rounded-lg text-fm-outline hover:text-fm-primary hover:bg-fm-surface-container transition-colors'}
      >
        <SmileIcon size={18} />
      </button>
      {mounted && panel && createPortal(panel, document.body)}
    </>
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
