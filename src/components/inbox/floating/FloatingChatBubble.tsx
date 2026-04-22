'use client'

import { useEffect, useRef, useState } from 'react'
import { useConversationMessages } from '@/hooks/useInboxPolling'
import { markConversationRead } from '@/app/actions/inbox'
import { sendMessage } from '@/app/actions/inbox'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { useUser } from '@/contexts/UserContext'
import type { ConversationListItem } from '@/types/db'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

interface FloatingChatBubbleProps {
  conversation: ConversationListItem
  onClose: (id: string) => void
  onMinimize: (id: string) => void
  minimized: boolean
}

export function FloatingChatBubble({ conversation, onClose, onMinimize, minimized }: FloatingChatBubbleProps) {
  const user = useUser()
  const { messages, refresh } = useConversationMessages(conversation.id)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const label =
    conversation.type === 'channel'
      ? conversation.name ?? 'Canal'
      : conversation.counterpart?.full_name ?? 'Usuario'

  useEffect(() => {
    if (!minimized) {
      markConversationRead(conversation.id).catch(() => {})
    }
  }, [conversation.id, minimized])

  useEffect(() => {
    if (!minimized) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, minimized])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    setBody('')
    await sendMessage({ conversationId: conversation.id, body: text })
    refresh()
    setSending(false)
  }

  return (
    <div className="flex flex-col bg-fm-surface-container-lowest border border-fm-surface-container-high rounded-xl shadow-xl overflow-hidden w-[280px] max-w-[calc(100vw-2rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#00675c] text-white">
        <div className="flex items-center gap-2 min-w-0">
          {conversation.type === 'dm' ? (
            <UserAvatar
              name={conversation.counterpart?.full_name ?? '?'}
              avatarUrl={conversation.counterpart?.avatar_url}
              size="xs"
            />
          ) : (
            <span className="font-bold text-sm">#</span>
          )}
          <span className="text-xs font-semibold truncate text-white">{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMinimize(conversation.id)}
            className="p-1 rounded hover:bg-white/20 transition-colors"
            aria-label={minimized ? 'Expandir' : 'Minimizar'}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              {minimized ? (
                <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/>
              ) : (
                <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/>
              )}
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onClose(conversation.id)}
            className="p-1 rounded hover:bg-white/20 transition-colors"
            aria-label="Cerrar"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          {/* Messages */}
          <div className="overflow-y-auto px-3 py-2 space-y-2 bg-fm-background h-[160px]">
            {messages.length === 0 && (
              <p className="text-xs text-fm-on-surface-variant text-center mt-6">Sin mensajes aún</p>
            )}
            {messages.map((msg) => {
              const isMe = msg.user_id === user.id
              return (
                <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  {!isMe && (
                    <span className="text-[10px] text-fm-on-surface-variant mb-0.5 px-1">
                      {msg.author?.full_name ?? 'Usuario'}
                    </span>
                  )}
                  <div
                    className={`max-w-[90%] rounded-xl px-3 py-1.5 text-xs ${
                      isMe
                        ? 'bg-[#00675c] text-white rounded-br-sm'
                        : 'bg-fm-surface-container-low text-fm-on-surface border border-fm-surface-container-high rounded-bl-sm'
                    }`}
                  >
                    {msg.body}
                  </div>
                  <span className="text-[9px] text-fm-on-surface-variant/60 px-1 mt-0.5">
                    {formatDistanceToNow(parseISO(msg.created_at), { locale: es, addSuffix: true })}
                  </span>
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSend} className="flex items-center gap-1 px-2 py-2 border-t border-fm-surface-container-high">
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Escribe un mensaje..."
              className="flex-1 text-xs text-fm-on-surface bg-fm-background rounded-lg px-3 py-1.5 outline-none border border-fm-surface-container-high focus:border-fm-primary placeholder:text-fm-on-surface-variant/50"
              disabled={sending}
            />
            <button
              type="submit"
              disabled={!body.trim() || sending}
              className="p-1.5 rounded-lg bg-[#00675c] text-white disabled:opacity-40 hover:bg-[#005549] transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          </form>
        </>
      )}
    </div>
  )
}
