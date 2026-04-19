'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface ChatMessage {
  id: string
  body: string
  created_at: string
  user_id: string
  user: { full_name: string; role: string } | null
}

interface RequirementChatProps {
  requirementId: string
  currentUserId: string
}

export function RequirementChat({ requirementId, currentUserId }: RequirementChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    loadMessages()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirementId])

  async function loadMessages() {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('requirement_messages')
      .select('id, body, created_at, user_id, user:users(full_name, role)')
      .eq('requirement_id', requirementId)
      .order('created_at', { ascending: true })
    setMessages((data ?? []) as ChatMessage[])
    setLoading(false)
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    const trimmed = body.trim()
    if (!trimmed || sending) return
    setSending(true)
    const supabase = createClient()
    const { data: inserted } = await supabase
      .from('requirement_messages')
      .insert({ requirement_id: requirementId, user_id: currentUserId, body: trimmed })
      .select('id, body, created_at, user_id, user:users(full_name, role)')
      .single()
    if (inserted) setMessages((prev) => [...prev, inserted as ChatMessage])
    setBody('')
    setSending(false)
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  // Group messages by date
  const grouped: { date: string; msgs: ChatMessage[] }[] = []
  for (const msg of messages) {
    const date = formatDate(msg.created_at)
    const last = grouped[grouped.length - 1]
    if (last && last.date === date) {
      last.msgs.push(msg)
    } else {
      grouped.push({ date, msgs: [msg] })
    }
  }

  function initials(name: string) {
    return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
        {loading ? (
          <p className="text-sm text-[#abadaf] text-center py-8">Cargando mensajes…</p>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <span className="material-symbols-outlined text-3xl text-[#dfe3e6]">chat</span>
            <p className="text-sm text-[#abadaf]">Sin mensajes aún. ¡Sé el primero!</p>
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.date} className="space-y-3">
              {/* Date divider */}
              <div className="flex items-center gap-3 my-2">
                <div className="flex-1 h-px bg-[#eef1f3]" />
                <span className="text-[10px] font-semibold text-[#abadaf] uppercase tracking-wider whitespace-nowrap">
                  {group.date}
                </span>
                <div className="flex-1 h-px bg-[#eef1f3]" />
              </div>

              {group.msgs.map((msg) => {
                const isMine = msg.user_id === currentUserId
                const name = msg.user?.full_name ?? 'Usuario'
                const role = msg.user?.role ?? ''
                return (
                  <div key={msg.id} className={`flex gap-2 items-end ${isMine ? 'flex-row-reverse' : ''}`}>
                    {/* Avatar */}
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                      style={{
                        background: isMine
                          ? 'linear-gradient(135deg,#5c4a8a,#b89cff)'
                          : 'linear-gradient(135deg,#00675c,#5bf4de)',
                      }}
                    >
                      {initials(name)}
                    </div>

                    <div className={`flex flex-col max-w-[75%] ${isMine ? 'items-end' : 'items-start'}`}>
                      <span className="text-[10px] text-[#abadaf] font-semibold mb-1">
                        {isMine ? 'Tú' : name}
                        {role === 'admin' && !isMine && (
                          <span className="ml-1 text-[9px] bg-[#5c4a8a]/10 text-[#5c4a8a] px-1.5 py-0.5 rounded-full">
                            Admin
                          </span>
                        )}
                      </span>
                      <div
                        className={`px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                          isMine
                            ? 'text-white rounded-br-sm'
                            : 'bg-[#f0f2f4] text-[#2c2f31] rounded-bl-sm'
                        }`}
                        style={
                          isMine
                            ? { background: 'linear-gradient(135deg,#00675c,#029e90)' }
                            : undefined
                        }
                      >
                        {msg.body}
                      </div>
                      <span className="text-[10px] text-[#c8cacc] mt-1">{formatTime(msg.created_at)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="flex gap-2 items-end px-5 py-3 border-t border-[#eef1f3] flex-shrink-0">
        <textarea
          ref={inputRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escribe un mensaje interno… (Enter para enviar)"
          rows={1}
          className="flex-1 resize-none bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl px-3 py-2 text-sm text-[#2c2f31] outline-none focus:border-[#00675c] min-h-[38px] max-h-[96px]"
          style={{ fieldSizing: 'content' } as React.CSSProperties}
        />
        <button
          onClick={handleSend}
          disabled={!body.trim() || sending}
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-opacity"
          style={{ background: 'linear-gradient(135deg,#00675c,#5bf4de)' }}
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
