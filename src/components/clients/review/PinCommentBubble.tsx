'use client'

import { useEffect, useRef, useState } from 'react'
import { SendIcon, XIcon } from 'lucide-react'
import { MentionAutocomplete } from '@/components/requirements/MentionAutocomplete'
import type { UserRole } from '@/types/db'

interface UserMini {
  id: string
  full_name: string
  avatar_url: string | null
  role: UserRole
}

interface PinCommentBubbleProps {
  xPct: number
  yPct: number
  users: UserMini[]
  onSubmit: (body: string, mentionedUserIds: string[]) => Promise<void> | void
  onCancel: () => void
  submitting?: boolean
}

export function PinCommentBubble({
  xPct,
  yPct,
  users,
  onSubmit,
  onCancel,
  submitting,
}: PinCommentBubbleProps) {
  const [body, setBody] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const left = xPct > 70 ? `calc(${xPct}% - 240px)` : `${xPct}%`
  const top = yPct > 70 ? `calc(${yPct}% - 140px)` : `${yPct}%`

  async function handleSubmit() {
    const trimmed = body.trim()
    if (!trimmed || submitting) return
    await onSubmit(trimmed, mentionIds)
  }

  return (
    <div
      className="absolute z-20 w-[260px] bg-white rounded-xl shadow-2xl ring-1 ring-black/10 p-2"
      style={{ left, top, transform: 'translate(8px, 8px)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between mb-1">
        <span className="text-[11px] font-semibold text-[#2a2a2a] px-1">Nuevo comentario</span>
        <button
          onClick={onCancel}
          className="text-[#595c5e] hover:text-[#2a2a2a] p-0.5 rounded hover:bg-[#f5f7f9]"
          aria-label="Cancelar"
        >
          <XIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="relative">
        <MentionAutocomplete
          textareaRef={inputRef}
          value={body}
          onChange={setBody}
          users={users}
          currentMentionIds={mentionIds}
          onMentionsChange={setMentionIds}
        />
        <textarea
          ref={inputRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit()
            }
            if (e.key === 'Escape') onCancel()
          }}
          placeholder="Escribir un mensaje... (@ para mencionar)"
          rows={2}
          className="w-full text-xs text-[#2a2a2a] placeholder:text-[#8a8f93] bg-[#f5f7f9] rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
        />
      </div>
      <div className="flex justify-end mt-1">
        <button
          onClick={handleSubmit}
          disabled={!body.trim() || submitting}
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#00675c] text-white text-[11px] font-semibold disabled:opacity-40 hover:bg-[#004d45] transition-colors"
        >
          <SendIcon className="w-3 h-3" />
          Enviar
        </button>
      </div>
    </div>
  )
}
