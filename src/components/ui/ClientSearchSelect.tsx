'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import type { Client } from '@/types/db'

interface ClientSearchSelectProps {
  clients: Client[]
  value: string
  onChange: (clientId: string) => void
  placeholder?: string
  disabled?: boolean
  required?: boolean
}

export function ClientSearchSelect({
  clients,
  value,
  onChange,
  placeholder = 'Buscar cliente…',
  disabled = false,
  required = false,
}: ClientSearchSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightIndex, setHighlightIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = useMemo(
    () => clients.find((c) => c.id === value) ?? null,
    [clients, value],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) => c.name.toLowerCase().includes(q))
  }, [clients, query])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  useEffect(() => {
    if (open) {
      Promise.resolve().then(() => inputRef.current?.focus())
    }
  }, [open])

  function selectClient(c: Client) {
    onChange(c.id)
    setQuery('')
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const c = filtered[highlightIndex]
      if (c) selectClient(c)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      {/* Hidden input for required form validation */}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden
          required
          value={value}
          onChange={() => undefined}
          className="sr-only absolute opacity-0 pointer-events-none"
        />
      )}

      {!open && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setHighlightIndex(0)
            setOpen(true)
          }}
          className="w-full py-2 px-3 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl text-fm-on-surface focus:outline-none focus:border-fm-primary flex items-center justify-between gap-2 hover:border-fm-primary/40 transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0">
            {selected?.logo_url ? (
              <Image
                src={selected.logo_url}
                alt=""
                width={20}
                height={20}
                className="rounded-full object-cover flex-shrink-0"
                unoptimized
              />
            ) : selected ? (
              <span className="w-5 h-5 rounded-full bg-fm-primary/10 flex items-center justify-center text-[10px] font-bold text-fm-primary flex-shrink-0">
                {selected.name.slice(0, 2).toUpperCase()}
              </span>
            ) : null}
            <span className={selected ? 'truncate text-fm-on-surface' : 'truncate text-fm-on-surface-variant/70'}>
              {selected?.name ?? placeholder}
            </span>
          </span>
          <span className="material-symbols-outlined text-[18px] text-fm-on-surface-variant/60 flex-shrink-0">
            expand_more
          </span>
        </button>
      )}

      {open && (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="w-full py-2 px-3 text-sm bg-fm-background border border-fm-primary rounded-xl text-fm-on-surface focus:outline-none"
          />
          <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-64 overflow-y-auto bg-fm-surface-container-lowest rounded-xl shadow-xl ring-1 ring-black/10">
            {filtered.length === 0 ? (
              <div className="py-6 text-center text-xs text-fm-on-surface-variant/70">
                Sin resultados
              </div>
            ) : (
              filtered.map((c, idx) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseEnter={() => setHighlightIndex(idx)}
                  onClick={() => selectClient(c)}
                  className={
                    'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ' +
                    (idx === highlightIndex ? 'bg-fm-primary/10' : 'hover:bg-fm-background')
                  }
                >
                  {c.logo_url ? (
                    <Image
                      src={c.logo_url}
                      alt=""
                      width={20}
                      height={20}
                      className="rounded-full object-cover flex-shrink-0"
                      unoptimized
                    />
                  ) : (
                    <span className="w-5 h-5 rounded-full bg-fm-primary/10 flex items-center justify-center text-[10px] font-bold text-fm-primary flex-shrink-0">
                      {c.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span className="truncate text-fm-on-surface">{c.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
