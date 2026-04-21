'use client'

import { useEffect, useMemo, useRef } from 'react'
import { format, isSameDay, parseISO, isToday, isYesterday } from 'date-fns'
import { es } from 'date-fns/locale'
import { MessageItem } from './MessageItem'
import { useConversationMessages } from '@/hooks/useInboxPolling'
import { markConversationRead } from '@/app/actions/inbox'
import type { MessageWithMeta } from '@/types/db'

interface MessageListProps {
  conversationId: string
  currentUserId: string
  initialMessages: MessageWithMeta[]
}

function dayLabel(iso: string): string {
  const d = parseISO(iso)
  if (isToday(d)) return 'Hoy'
  if (isYesterday(d)) return 'Ayer'
  return format(d, "d 'de' MMMM", { locale: es })
}

export function MessageList({ conversationId, currentUserId, initialMessages }: MessageListProps) {
  const { messages, removeMessage, updateMessage } = useConversationMessages(conversationId, initialMessages)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const lastCountRef = useRef(messages.length)

  // Auto-scroll al fondo cuando llegan mensajes nuevos y el usuario ya estaba cerca del fondo
  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    const nearBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 160
    if (messages.length > lastCountRef.current && nearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    lastCountRef.current = messages.length
  }, [messages.length])

  // Scroll inicial al fondo sin animar
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [conversationId])

  // Marcar leído al montar y cada vez que llegue un mensaje mientras la pestaña está visible
  useEffect(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      markConversationRead(conversationId)
    }
  }, [conversationId, messages.length])

  const groups = useMemo(() => {
    const out: Array<{ date: string; items: MessageWithMeta[] }> = []
    for (const m of messages) {
      const last = out[out.length - 1]
      if (last && isSameDay(parseISO(last.date), parseISO(m.created_at))) {
        last.items.push(m)
      } else {
        out.push({ date: m.created_at, items: [m] })
      }
    }
    return out
  }, [messages])

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#f5f7f9]"
    >
      {messages.length === 0 && (
        <div className="h-full flex items-center justify-center text-center text-[#595c5e]/70 text-sm">
          No hay mensajes aún. Envía el primero.
        </div>
      )}
      {groups.map((g) => (
        <div key={g.date} className="space-y-5">
          <div className="flex justify-center">
            <span className="px-3 py-1 rounded-full bg-white border border-[#dfe3e6] text-[#595c5e] text-[10px] font-bold uppercase tracking-wider">
              {dayLabel(g.date)}
            </span>
          </div>
          {g.items.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              currentUserId={currentUserId}
              onDeleted={() => removeMessage(m.id)}
              onUpdated={(patch) => updateMessage(m.id, patch)}
            />
          ))}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
