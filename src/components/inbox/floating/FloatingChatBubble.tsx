'use client'

import { useEffect, useRef, useState } from 'react'
import { useConversationMessages } from '@/hooks/useInboxPolling'
import { markConversationRead } from '@/app/actions/inbox'
import { sendMessage } from '@/app/actions/inbox'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { EmojiPicker } from '@/components/ui/EmojiPicker'
import { RequirementShareCard } from '@/components/inbox/RequirementShareCard'
import { parseReqShareBody } from '@/components/inbox/requirement-share-utils'
import { CallButtons } from '@/components/calls/CallButtons'
import { PresenceIndicator } from '@/components/presence/PresenceIndicator'
import { useUsersPresence } from '@/hooks/useUsersPresence'
import { useUser } from '@/contexts/UserContext'
import type { ConversationListItem, MessageWithMeta } from '@/types/db'
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
  const { messages, refresh, addLocalMessage, removeMessage } = useConversationMessages(conversation.id)
  const { getEffective } = useUsersPresence()
  const counterpartStatus =
    conversation.type === 'dm' && conversation.counterpart
      ? getEffective(conversation.counterpart.id)
      : null
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set())
  const [replyTo, setReplyTo] = useState<{ id: string; body: string; authorName: string } | null>(null)
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
    const tempId = `temp-${crypto.randomUUID()}`
    const optimistic: MessageWithMeta = {
      id: tempId,
      conversation_id: conversation.id,
      user_id: user.id,
      body: text,
      edited_at: null,
      deleted_at: null,
      created_at: new Date().toISOString(),
      kind: 'text',
      reply_to_message_id: replyTo?.id ?? null,
      reply_preview: replyTo ? { body: replyTo.body, author_name: replyTo.authorName } : null,
      author: {
        id: user.id,
        full_name: user.full_name,
        avatar_url: user.avatar_url,
      },
      attachments: [],
    }
    addLocalMessage(optimistic)
    const res = await sendMessage({ conversationId: conversation.id, body: text, replyToMessageId: replyTo?.id ?? null })
    setSending(false)
    if ('error' in res && res.error) {
      setFailedIds((prev) => {
        const next = new Set(prev)
        next.add(tempId)
        return next
      })
      setBody(text)
      return
    }
    setReplyTo(null)
    // El realtime insertará la fila real; eliminamos el optimistic al llegar.
    // Como fallback, limpiamos el temp tras un refresh.
    refresh()
    // El refresh reemplaza el array por los mensajes del servidor (sin temp),
    // así que no hace falta remover manualmente. Si refresh falla, el temp
    // permanece hasta el próximo fetch/realtime.
  }

  function retryFailed(tempId: string) {
    const msg = messages.find((m) => m.id === tempId)
    if (!msg) return
    removeMessage(tempId)
    setFailedIds((prev) => {
      const next = new Set(prev)
      next.delete(tempId)
      return next
    })
    setBody(msg.body)
  }

  return (
    <div className="flex flex-col bg-fm-surface-container-lowest border border-fm-surface-container-high rounded-xl shadow-xl w-[322px] max-w-[calc(100vw-2rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#00675c] text-white rounded-t-xl overflow-hidden">
        <div className="flex items-center gap-2 min-w-0">
          {conversation.type === 'dm' ? (
            <span className="relative inline-block">
              <UserAvatar
                name={conversation.counterpart?.full_name ?? '?'}
                avatarUrl={conversation.counterpart?.avatar_url}
                size="xs"
              />
              {counterpartStatus && (
                <PresenceIndicator status={counterpartStatus} overlay size="xs" />
              )}
            </span>
          ) : (
            <span className="font-bold text-sm">#</span>
          )}
          <span className="text-xs font-semibold truncate text-white">{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="mr-1">
            <CallButtons
              conversationId={conversation.id}
              title={label}
              counterpartAvatarUrl={
                conversation.type === 'dm' ? conversation.counterpart?.avatar_url : null
              }
              isChannelCall={conversation.type !== 'dm'}
              compact
              variant="dark"
            />
          </div>
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
          <div className="overflow-y-auto px-3 py-2 space-y-2 bg-fm-background h-[184px]">
            {messages.length === 0 && (
              <p className="text-xs text-fm-on-surface-variant text-center mt-6">Sin mensajes aún</p>
            )}
            {messages.map((msg) => {
              const isMe = msg.user_id === user.id
              const isPending = msg.id.startsWith('temp-')
              const isFailed = failedIds.has(msg.id)
              const share = parseReqShareBody(msg.body)
              return (
                <div key={msg.id} className={`flex flex-col group/msg ${isMe ? 'items-end' : 'items-start'}`}>
                  {!isMe && (
                    <span className="text-[10px] text-fm-on-surface-variant mb-0.5 px-1">
                      {msg.author?.full_name ?? 'Usuario'}
                    </span>
                  )}
                  {/* Preview de mensaje citado */}
                  {msg.reply_preview && (
                    <div
                      className={`max-w-[90%] px-2 py-1 rounded-md border-l-2 text-[9px] mb-0.5 ${
                        isMe
                          ? 'bg-black/15 border-white/60 text-white/85 dark:bg-white/15 dark:border-white/50 dark:text-white/70'
                          : 'bg-fm-surface-container-high border-[#00675c]/50 text-fm-on-surface-variant'
                      }`}
                    >
                      <span className="font-semibold block truncate">{msg.reply_preview.author_name}</span>
                      <span className="block truncate opacity-80">{msg.reply_preview.body}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    {isMe && !isPending && (
                      <button
                        type="button"
                        onClick={() => setReplyTo({ id: msg.id, body: msg.body, authorName: msg.author?.full_name ?? 'Usuario' })}
                        className="opacity-0 group-hover/msg:opacity-100 transition-opacity text-fm-on-surface-variant/60 hover:text-fm-primary"
                        title="Responder"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/>
                        </svg>
                      </button>
                    )}
                    {share ? (
                      <div className={`max-w-[95%] ${isPending && !isFailed ? 'opacity-60' : ''} ${isFailed ? 'ring-1 ring-[#b31b25] rounded-lg' : ''}`}>
                        <RequirementShareCard
                          requirementId={share.requirementId}
                          title={share.title}
                          isMine={isMe}
                        />
                      </div>
                    ) : (
                      <div
                        className={`max-w-[90%] rounded-xl px-3 py-1.5 text-xs transition-opacity ${
                          isMe
                            ? 'bg-[#00675c] text-white rounded-br-sm'
                            : 'bg-fm-surface-container-low text-fm-on-surface border border-fm-surface-container-high rounded-bl-sm'
                        } ${isPending && !isFailed ? 'opacity-60' : ''} ${isFailed ? 'ring-1 ring-[#b31b25]' : ''}`}
                      >
                        {msg.body}
                      </div>
                    )}
                    {!isMe && !isPending && (
                      <button
                        type="button"
                        onClick={() => setReplyTo({ id: msg.id, body: msg.body, authorName: msg.author?.full_name ?? 'Usuario' })}
                        className="opacity-0 group-hover/msg:opacity-100 transition-opacity text-fm-on-surface-variant/60 hover:text-fm-primary"
                        title="Responder"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/>
                        </svg>
                      </button>
                    )}
                  </div>
                  {isFailed ? (
                    <button
                      type="button"
                      onClick={() => retryFailed(msg.id)}
                      className="text-[9px] text-[#b31b25] px-1 mt-0.5 hover:underline"
                    >
                      Error al enviar · Reintentar
                    </button>
                  ) : (
                    <span className="text-[9px] text-fm-on-surface-variant/60 px-1 mt-0.5">
                      {isPending
                        ? 'Enviando…'
                        : formatDistanceToNow(parseISO(msg.created_at), { locale: es, addSuffix: true })}
                    </span>
                  )}
                </div>
              )
            })}
            <div ref={bottomRef} />
          </div>

          {/* Reply strip */}
          {replyTo && (
            <div className="flex items-start gap-2 px-3 py-1.5 border-t border-fm-surface-container-high bg-fm-surface-container-lowest">
              <div className="flex-1 min-w-0 border-l-2 border-[#00675c] pl-2">
                <p className="text-[9px] font-semibold text-[#00675c] truncate">↩ {replyTo.authorName}</p>
                <p className="text-[9px] text-fm-on-surface-variant truncate">{replyTo.body}</p>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="text-fm-on-surface-variant/60 hover:text-fm-error flex-shrink-0"
                aria-label="Cancelar respuesta"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
              </button>
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleSend} className="flex items-center gap-1 px-2 py-2 border-t border-fm-surface-container-high">
            <EmojiPicker
              align="top-left"
              triggerClassName="p-1.5 rounded-lg text-fm-on-surface-variant hover:text-fm-primary hover:bg-fm-surface-container transition-colors"
              onSelect={(char) => setBody(b => b + char)}
            />
            <input aria-label="Escribe un mensaje..."
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
