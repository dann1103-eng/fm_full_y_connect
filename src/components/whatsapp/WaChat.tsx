'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  markConversationRead,
  sendStaffReply,
  toggleBotForConversation,
  linkConversationToClient,
} from '@/app/actions/whatsapp'
import type { WaConversation, WaMessage } from '@/types/db'

interface ClientOption {
  id: string
  name: string
}

interface LeadInfo {
  id: string
  company_name: string | null
  contact_name: string | null
  interest: string | null
  budget_range: string | null
  urgency: string | null
  notes: string | null
  updated_at: string
}

interface Props {
  conversation: WaConversation
  initialMessages: WaMessage[]
  clients: ClientOption[]
  linkedClient: ClientOption | null
  lead?: LeadInfo | null
}

export function WaChat({ conversation, initialMessages, clients, linkedClient, lead: initialLead }: Props) {
  const [lead, setLead] = useState<LeadInfo | null>(initialLead ?? null)
  const [messages, setMessages] = useState<WaMessage[]>(initialMessages)
  const [paused, setPaused] = useState(conversation.bot_paused)
  const [client, setClient] = useState<ClientOption | null>(linkedClient)
  const [body, setBody] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Marca leído al entrar.
  useEffect(() => {
    void markConversationRead(conversation.id)
  }, [conversation.id])

  // Auto-scroll al final cuando cambia messages.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // Realtime: nuevos mensajes en la conversación.
  useEffect(() => {
    const supabase = createClient()
    const ch = supabase.channel(`wa-conv-${conversation.id}`)
    ch.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'wa_messages',
        filter: `conversation_id=eq.${conversation.id}`,
      },
      (payload) => {
        setMessages((prev) => {
          const next = payload.new as WaMessage
          if (prev.some((m) => m.id === next.id)) return prev
          return [...prev, next]
        })
      },
    )
    ch.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'wa_messages',
        filter: `conversation_id=eq.${conversation.id}`,
      },
      (payload) => {
        setMessages((prev) => prev.map((m) => (m.id === (payload.new as WaMessage).id ? (payload.new as WaMessage) : m)))
      },
    )
    ch.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'wa_conversations',
        filter: `id=eq.${conversation.id}`,
      },
      (payload) => {
        const next = payload.new as WaConversation
        setPaused(next.bot_paused)
      },
    )
    ch.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'wa_leads',
        filter: `conversation_id=eq.${conversation.id}`,
      },
      (payload) => {
        const next = payload.new as LeadInfo | undefined
        if (next && next.id) setLead(next)
      },
    )
    ch.subscribe()

    return () => {
      ch.unsubscribe()
    }
  }, [conversation.id])

  function handleSend() {
    setError(null)
    const text = body.trim()
    if (!text) return
    startTransition(async () => {
      const res = await sendStaffReply(conversation.id, text)
      if (!res.ok) {
        setError(res.error)
      } else {
        setBody('')
      }
    })
  }

  function handleTogglePause() {
    startTransition(async () => {
      const next = !paused
      setPaused(next)
      const res = await toggleBotForConversation(conversation.id, next)
      if (!res.ok) {
        setError(res.error)
        setPaused(!next)
      }
    })
  }

  function handleLink(clientId: string) {
    if (!clientId) return
    const c = clients.find((x) => x.id === clientId) ?? null
    setClient(c)
    startTransition(async () => {
      const res = await linkConversationToClient({
        conversationId: conversation.id,
        clientId,
        saveAsContact: true,
      })
      if (!res.ok) setError(res.error)
    })
  }

  const title = client?.name ?? conversation.display_name ?? conversation.phone_e164

  return (
    <section className="flex flex-col flex-1 min-w-0 bg-fm-background">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-fm-outline-variant/30 bg-fm-surface">
        <div className="min-w-0">
          <h2 className="font-medium text-fm-on-surface truncate">{title}</h2>
          <p className="text-xs text-fm-on-surface-variant truncate">
            {conversation.phone_e164}
            {client && <span> · vinculado a {client.name}</span>}
            {!client && <span className="text-orange-600"> · sin cliente vinculado</span>}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!client && clients.length > 0 && (
            <select
              defaultValue=""
              onChange={(e) => handleLink(e.target.value)}
              className="text-sm border border-fm-outline-variant/40 rounded-md px-2 py-1 bg-fm-surface-container-low"
              disabled={pending}
            >
              <option value="" disabled>Vincular a cliente…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={handleTogglePause}
            disabled={pending}
            className={cn(
              'text-sm px-3 py-1.5 rounded-md border transition',
              paused
                ? 'border-fm-primary text-fm-primary hover:bg-fm-primary/10'
                : 'border-red-300 text-red-700 hover:bg-red-50',
            )}
          >
            {paused ? 'Reanudar bot' : 'Pausar bot'}
          </button>
        </div>
      </header>

      {lead && !linkedClient && <LeadPanel lead={lead} />}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {messages.length === 0 && (
          <p className="text-center text-sm text-fm-on-surface-variant py-8">Sin mensajes todavía.</p>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>

      <footer className="border-t border-fm-outline-variant/30 bg-fm-surface px-3 py-3">
        {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
        <div className="flex items-end gap-2">
          <textarea aria-label="Escribe tu respuesta… (Enter para enviar, Shift+Enter salto de línea)"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            rows={2}
            placeholder="Escribe tu respuesta… (Enter para enviar, Shift+Enter salto de línea)"
            className="flex-1 px-3 py-2 text-sm rounded-md bg-fm-surface-container-low border border-fm-outline-variant/40 outline-none focus:border-fm-primary resize-none"
            disabled={pending}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={pending || !body.trim()}
            className="px-4 py-2 text-sm rounded-md bg-fm-primary text-white disabled:opacity-50"
          >
            Enviar
          </button>
        </div>
        <p className="text-[11px] text-fm-on-surface-variant mt-2">
          Al enviar manualmente, el bot se pausa automáticamente en esta conversación.
        </p>
      </footer>
    </section>
  )
}

function LeadPanel({ lead }: { lead: LeadInfo }) {
  const rows: Array<[string, string | null]> = [
    ['Empresa', lead.company_name],
    ['Contacto', lead.contact_name],
    ['Interés', lead.interest],
    ['Presupuesto', lead.budget_range],
    ['Urgencia', lead.urgency],
    ['Notas', lead.notes],
  ]
  const populated = rows.filter(([, v]) => v && v.trim())
  if (populated.length === 0) return null

  return (
    <div className="border-b border-fm-outline-variant/30 bg-amber-50/50 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="material-symbols-outlined text-[16px] text-amber-700">person_search</span>
        <h3 className="text-xs font-medium text-amber-900 uppercase tracking-wide">Info del lead (recopilada por el bot)</h3>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {populated.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="font-medium text-fm-on-surface-variant min-w-[70px]">{k}:</dt>
            <dd className="text-fm-on-surface">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function MessageBubble({ message }: { message: WaMessage }) {
  const isInbound = message.direction === 'inbound'
  const sentBy = message.sent_by
  const label =
    sentBy === 'bot' ? 'Bot' :
    sentBy === 'staff' ? 'Equipo' :
    isInbound ? 'Cliente' : 'Sistema'

  return (
    <div className={cn('flex', isInbound ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-sm',
          isInbound
            ? 'bg-white text-fm-on-surface border border-fm-outline-variant/30'
            : sentBy === 'bot'
              ? 'bg-fm-primary/10 text-fm-on-surface'
              : 'bg-fm-primary text-white',
        )}
      >
        <div className="text-[10px] uppercase tracking-wide opacity-70 mb-0.5">
          {label}
          {message.wa_status === 'failed' && <span className="ml-1 text-red-600">— falló</span>}
        </div>
        <div className="whitespace-pre-wrap break-words">
          {renderMessageBody(message)}
        </div>
        <div className="text-[10px] opacity-60 mt-1 text-right">
          {new Date(message.created_at).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}

function renderMessageBody(m: WaMessage): string {
  if (m.msg_type === 'text') return m.body ?? ''
  if (m.msg_type === 'image') return `📷 Imagen${m.body ? ' — ' + m.body : ''}`
  if (m.msg_type === 'audio') return '🎤 Audio'
  if (m.msg_type === 'video') return `🎬 Video${m.body ? ' — ' + m.body : ''}`
  if (m.msg_type === 'document') return `📎 ${m.body ?? 'Documento'}`
  if (m.msg_type === 'sticker') return '🩹 Sticker'
  if (m.msg_type === 'location') return m.body ?? '📍 Ubicación'
  if (m.msg_type === 'interactive') return m.body ?? '[respuesta interactiva]'
  return m.body ?? `[${m.msg_type}]`
}
