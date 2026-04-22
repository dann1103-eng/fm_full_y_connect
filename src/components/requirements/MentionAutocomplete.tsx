'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { UserAvatar } from '@/components/ui/UserAvatar'
import type { AppUser } from '@/types/db'

type MentionableUser = Pick<AppUser, 'id' | 'full_name' | 'avatar_url' | 'role'>

interface MentionAutocompleteProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (next: string) => void
  users: MentionableUser[]
  /** Llamado cada vez que cambia el conjunto de usuarios etiquetados (ids). */
  onMentionsChange: (ids: string[]) => void
  /** Menciones actuales confirmadas (se recalculan al cambiar value). */
  currentMentionIds: string[]
}

interface MentionState {
  active: boolean
  start: number
  query: string
  selectedIdx: number
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** Detecta si el cursor está dentro de un token "@algo" (sin espacios desde el @). */
function detectMention(text: string, caret: number): { start: number; query: string } | null {
  if (caret === 0) return null
  let i = caret - 1
  while (i >= 0) {
    const ch = text[i]
    if (ch === '@') {
      const prev = i > 0 ? text[i - 1] : ' '
      if (/\s|[,.;:!?(\[{]/.test(prev) || i === 0) {
        return { start: i, query: text.slice(i + 1, caret) }
      }
      return null
    }
    if (/\s/.test(ch)) return null
    i--
  }
  return null
}

export function MentionAutocomplete({
  textareaRef,
  value,
  onChange,
  users,
  onMentionsChange,
  currentMentionIds,
}: MentionAutocompleteProps) {
  const [state, setState] = useState<MentionState>({ active: false, start: 0, query: '', selectedIdx: 0 })
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!state.active) return
    const ta = textareaRef.current
    if (!ta) return
    const rect = ta.getBoundingClientRect()
    const spaceAbove = rect.top
    const spaceBelow = window.innerHeight - rect.bottom
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlacement(spaceAbove < 220 && spaceBelow > spaceAbove ? 'bottom' : 'top')
  }, [state.active, textareaRef])

  const filtered = useMemo(() => {
    if (!state.active) return []
    const q = stripAccents(state.query.trim())
    const base = users
      .filter((u) => u.full_name)
      .sort((a, b) => stripAccents(a.full_name ?? '').localeCompare(stripAccents(b.full_name ?? '')))
    if (!q) return base
    return base.filter((u) => stripAccents(u.full_name ?? '').includes(q))
  }, [users, state.active, state.query])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    function handleSelect() {
      if (!ta) return
      const caret = ta.selectionStart ?? 0
      const det = detectMention(value, caret)
      if (!det) {
        setState((s) => (s.active ? { ...s, active: false } : s))
        return
      }
      setState({ active: true, start: det.start, query: det.query, selectedIdx: 0 })
    }
    ta.addEventListener('keyup', handleSelect)
    ta.addEventListener('click', handleSelect)
    ta.addEventListener('focus', handleSelect)
    return () => {
      ta.removeEventListener('keyup', handleSelect)
      ta.removeEventListener('click', handleSelect)
      ta.removeEventListener('focus', handleSelect)
    }
  }, [textareaRef, value])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta || !state.active) return
    function onKeyDown(e: KeyboardEvent) {
      if (!state.active || filtered.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setState((s) => ({ ...s, selectedIdx: (s.selectedIdx + 1) % filtered.length }))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setState((s) => ({ ...s, selectedIdx: (s.selectedIdx - 1 + filtered.length) % filtered.length }))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const user = filtered[state.selectedIdx]
        if (user) applyMention(user)
      } else if (e.key === 'Escape') {
        setState((s) => ({ ...s, active: false }))
      }
    }
    ta.addEventListener('keydown', onKeyDown, true)
    return () => ta.removeEventListener('keydown', onKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.active, filtered, state.selectedIdx])

  function applyMention(user: MentionableUser) {
    const ta = textareaRef.current
    if (!ta) return
    const caret = ta.selectionStart ?? value.length
    const before = value.slice(0, state.start)
    const after = value.slice(caret)
    const token = `@${user.full_name} `
    const next = before + token + after
    onChange(next)
    const newCaret = before.length + token.length
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(newCaret, newCaret)
    })
    setState((s) => ({ ...s, active: false }))
    const nextIds = Array.from(new Set([...currentMentionIds, user.id]))
    onMentionsChange(nextIds)
  }

  useEffect(() => {
    const ids = new Set<string>()
    for (const u of users) {
      if (!u.full_name) continue
      const pattern = new RegExp(`@${u.full_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$|[.,;:!?])`, 'u')
      if (pattern.test(value)) ids.add(u.id)
    }
    const arr = Array.from(ids)
    const same = arr.length === currentMentionIds.length && arr.every((id) => currentMentionIds.includes(id))
    if (!same) onMentionsChange(arr)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, users])

  if (!state.active || filtered.length === 0) return null

  return (
    <div
      ref={listRef}
      className={
        'absolute left-0 right-0 mx-5 z-50 bg-fm-surface-container-lowest rounded-xl shadow-xl ring-1 ring-black/10 max-h-64 overflow-y-auto ' +
        (placement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1')
      }
    >
      {filtered.map((u, idx) => (
        <button
          key={u.id}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            applyMention(u)
          }}
          className={
            'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ' +
            (idx === state.selectedIdx ? 'bg-fm-primary/10' : 'hover:bg-fm-background')
          }
        >
          <UserAvatar name={u.full_name ?? '?'} avatarUrl={u.avatar_url} size="xs" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-fm-on-surface truncate">{u.full_name}</div>
            <div className="text-[10px] text-fm-on-surface-variant/70 capitalize">{u.role}</div>
          </div>
        </button>
      ))}
    </div>
  )
}
