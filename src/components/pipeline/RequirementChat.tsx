'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { uploadRequirementAttachment } from '@/lib/supabase/upload-req-attachment'
import { sendRequirementMessage, deleteRequirementMessage } from '@/app/actions/requirement-messages'
import { MentionAutocomplete } from '@/components/requirements/MentionAutocomplete'
import type { AppUser } from '@/types/db'

type MentionableUser = Pick<AppUser, 'id' | 'full_name' | 'avatar_url' | 'role'>

interface ChatMessage {
  id: string
  body: string
  created_at: string
  user_id: string
  attachment_path: string | null
  attachment_type: string | null
  attachment_name: string | null
  visible_to_client: boolean
  user: { full_name: string; role: string; avatar_url: string | null } | null
}

interface RequirementChatProps {
  requirementId: string
  currentUserId: string
  isAdmin?: boolean
  /** Renderizado desde el portal del cliente: mensajes visibles al cliente, sin @-menciones. */
  clientMode?: boolean
}

function publicUrlFor(path: string): string {
  const supabase = createClient()
  return supabase.storage.from('requirement-attachments').getPublicUrl(path).data.publicUrl
}

export function RequirementChat({ requirementId, currentUserId, isAdmin = false, clientMode = false }: RequirementChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [users, setUsers] = useState<MentionableUser[]>([])
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [visibleToClient, setVisibleToClient] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadMessages()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirementId])

  useEffect(() => {
    const supabase = createClient()
    let debounce: ReturnType<typeof setTimeout> | null = null
    const scheduleReload = () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        loadMessages(true)
      }, 250)
    }
    const channel = supabase
      .channel(`req-chat-${requirementId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'requirement_messages', filter: `requirement_id=eq.${requirementId}` },
        scheduleReload
      )
      .subscribe()
    return () => {
      if (debounce) clearTimeout(debounce)
      supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirementId])

  useEffect(() => {
    if (clientMode) return
    const supabase = createClient()
    supabase
      .from('users')
      .select('id, full_name, avatar_url, role')
      .neq('id', currentUserId)
      .not('role', 'eq', 'client')
      .then(({ data }) => {
        setUsers((data ?? []) as MentionableUser[])
      })
  }, [currentUserId, clientMode])

  async function loadMessages(silent = false) {
    if (!silent) setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('requirement_messages')
      .select('id, body, created_at, user_id, attachment_path, attachment_type, attachment_name, visible_to_client, user:users(full_name, role, avatar_url)')
      .eq('requirement_id', requirementId)
      .order('created_at', { ascending: true })
    setMessages((data ?? []) as ChatMessage[])
    if (!silent) setLoading(false)
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Clean up object URL when preview changes
  useEffect(() => {
    return () => {
      if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    }
  }, [pendingPreview])

  function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permitir reseleccionar el mismo archivo
    if (!file) return
    setUploadError(null)
    // Preview con object URL
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    const url = URL.createObjectURL(file)
    setPendingFile(file)
    setPendingPreview(url)
  }

  function clearPendingFile() {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingFile(null)
    setPendingPreview(null)
  }

  async function handleSend() {
    const trimmed = body.trim()
    if ((!trimmed && !pendingFile) || sending) return
    setSending(true)
    setUploadError(null)

    let attachmentPath: string | null = null
    let attachmentType: string | null = null
    let attachmentName: string | null = null

    if (pendingFile) {
      try {
        const uploaded = await uploadRequirementAttachment(pendingFile, requirementId)
        attachmentPath = uploaded.path
        attachmentType = uploaded.mime
        attachmentName = uploaded.name
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : 'Error al subir la imagen.')
        setSending(false)
        return
      }
    }

    const res = await sendRequirementMessage({
      requirementId,
      body: trimmed,
      attachmentPath,
      attachmentType,
      attachmentName,
      mentionedUserIds: clientMode ? [] : mentionIds,
      visibleToClient: clientMode || visibleToClient,
    })
    if ('error' in res && res.error) {
      setUploadError(res.error)
      setSending(false)
      return
    }
    if ('message' in res && res.message) {
      setMessages((prev) => [...prev, res.message as ChatMessage])
    }
    setBody('')
    setMentionIds([])
    setVisibleToClient(false)
    clearPendingFile()
    setSending(false)
    inputRef.current?.focus()
  }

  async function handleDelete(messageId: string) {
    if (deletingId) return
    if (!confirm('¿Borrar este mensaje?')) return
    setDeletingId(messageId)
    const res = await deleteRequirementMessage(messageId)
    if ('error' in res && res.error) {
      setUploadError(res.error)
      setDeletingId(null)
      return
    }
    setMessages((prev) => prev.filter((m) => m.id !== messageId))
    setDeletingId(null)
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

  // Renderiza texto con URLs como enlaces y @menciones resaltadas en teal.
  function renderWithLinks(text: string, isMine: boolean): React.ReactNode[] {
    const TOKEN_RE = /(https?:\/\/[^\s]+|www\.[^\s]+|@[\p{L}][\p{L}\p{M}0-9_.'-]*(?:\s[\p{L}][\p{L}\p{M}0-9_.'-]*)?)/gu
    const nodes: React.ReactNode[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null
    let idx = 0
    const knownNames = new Set(
      users.map((u) => (u.full_name ?? '').toLowerCase()).filter(Boolean),
    )
    while ((match = TOKEN_RE.exec(text)) !== null) {
      const matchStart = match.index
      if (matchStart > lastIndex) {
        nodes.push(text.slice(lastIndex, matchStart))
      }
      const raw = match[0]
      if (raw.startsWith('@')) {
        const candidate = raw.slice(1).toLowerCase()
        const isKnown = Array.from(knownNames).some(
          (name) => candidate === name || candidate.startsWith(name),
        )
        if (isKnown) {
          nodes.push(
            <span
              key={`mention-${idx++}`}
              className={
                'font-semibold ' +
                (isMine ? 'text-white underline decoration-white/60' : 'text-fm-primary')
              }
            >
              {raw}
            </span>,
          )
        } else {
          nodes.push(raw)
        }
      } else {
        const href = raw.startsWith('http') ? raw : `https://${raw}`
        nodes.push(
          <a
            key={`lnk-${idx++}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-dotted hover:opacity-80 break-all"
          >
            {raw}
          </a>,
        )
      }
      lastIndex = matchStart + raw.length
    }
    if (lastIndex < text.length) {
      nodes.push(text.slice(lastIndex))
    }
    return nodes
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0">
        {loading ? (
          <p className="text-sm text-fm-outline-variant text-center py-8">Cargando mensajes…</p>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <span className="material-symbols-outlined text-3xl text-fm-surface-container-high">chat</span>
            <p className="text-sm text-fm-outline-variant">Sin mensajes aún. ¡Sé el primero!</p>
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.date} className="space-y-3">
              {/* Date divider */}
              <div className="flex items-center gap-3 my-2">
                <div className="flex-1 h-px bg-fm-surface-container-low" />
                <span className="text-[10px] font-semibold text-fm-outline-variant uppercase tracking-wider whitespace-nowrap">
                  {group.date}
                </span>
                <div className="flex-1 h-px bg-fm-surface-container-low" />
              </div>

              {group.msgs.map((msg) => {
                const isMine = msg.user_id === currentUserId
                const name = msg.user?.full_name ?? 'Usuario'
                const role = msg.user?.role ?? ''
                const avatarUrl = msg.user?.avatar_url ?? null
                const imgUrl = msg.attachment_path ? publicUrlFor(msg.attachment_path) : null
                const canDelete = isMine || isAdmin
                return (
                  <div key={msg.id} className={`group flex gap-2 items-end ${isMine ? 'flex-row-reverse' : ''}`}>
                    {/* Avatar (foto si existe, fallback a iniciales con gradiente) */}
                    {avatarUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={avatarUrl}
                        alt={name}
                        className="w-7 h-7 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
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
                    )}

                    <div className={`flex flex-col max-w-[75%] ${isMine ? 'items-end' : 'items-start'}`}>
                      <span className="text-[10px] text-fm-outline-variant font-semibold mb-1">
                        {isMine ? 'Tú' : name}
                        {role === 'admin' && !isMine && (
                          <span className="ml-1 text-[9px] bg-fm-tertiary-container/30 text-fm-tertiary px-1.5 py-0.5 rounded-full">
                            Admin
                          </span>
                        )}
                      </span>

                      {imgUrl && (
                        <button
                          type="button"
                          onClick={() => setLightbox(imgUrl)}
                          className={`mb-1 overflow-hidden rounded-2xl border border-fm-surface-container-low bg-fm-background ${
                            isMine ? 'rounded-br-sm' : 'rounded-bl-sm'
                          }`}
                          title={msg.attachment_name ?? 'Ver imagen'}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={imgUrl}
                            alt={msg.attachment_name ?? 'Adjunto'}
                            className="block max-w-full max-h-64 object-contain"
                          />
                        </button>
                      )}

                      {msg.body && (
                        <div
                          className={`px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                            isMine
                              ? 'text-white rounded-br-sm bg-gradient-to-br from-[#00675c] to-[#029e90] dark:bg-none dark:bg-fm-primary/25 dark:text-teal-100 dark:border dark:border-fm-primary/40'
                              : 'bg-fm-surface-container-low text-fm-on-surface rounded-bl-sm'
                          }`}
                        >
                          {renderWithLinks(msg.body, isMine)}
                        </div>
                      )}
                      <span className="text-[10px] text-fm-outline-variant mt-1 flex items-center gap-1.5">
                        {formatTime(msg.created_at)}
                        {!clientMode && msg.visible_to_client && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-fm-primary bg-fm-primary/10 px-1.5 py-0.5 rounded-full">
                            <span className="material-symbols-outlined text-[10px] leading-none">visibility</span>
                            Cliente
                          </span>
                        )}
                      </span>
                    </div>

                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(msg.id)}
                        disabled={deletingId === msg.id}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-fm-error p-1 rounded hover:bg-fm-error/10 self-center flex-shrink-0 disabled:opacity-40"
                        title="Borrar mensaje"
                      >
                        <span className="material-symbols-outlined text-base">delete</span>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Preview del adjunto pendiente */}
      {pendingPreview && (
        <div className="px-5 py-2 border-t border-fm-surface-container-low flex items-center gap-3 flex-shrink-0 bg-fm-background">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pendingPreview} alt="Preview" className="w-12 h-12 object-cover rounded-lg" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-fm-on-surface truncate">
              {pendingFile?.name}
            </p>
            <p className="text-[10px] text-fm-outline">
              Se comprimirá automáticamente antes de enviar
            </p>
          </div>
          <button
            onClick={clearPendingFile}
            className="text-fm-error p-1 rounded hover:bg-fm-error/10"
            title="Quitar adjunto"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
      )}

      {uploadError && (
        <div className="px-5 py-2 bg-fm-error/5 border-t border-fm-error/20 text-xs text-fm-error font-medium flex-shrink-0">
          {uploadError}
        </div>
      )}

      {/* Input bar */}
      <div className="relative flex gap-2 items-end px-5 py-3 border-t border-fm-surface-container-low flex-shrink-0">
        {!clientMode && (
          <MentionAutocomplete
            textareaRef={inputRef}
            value={body}
            onChange={setBody}
            users={users}
            currentMentionIds={mentionIds}
            onMentionsChange={setMentionIds}
          />
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handlePickFile}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          title="Adjuntar imagen"
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-fm-background border border-fm-surface-container-high text-fm-on-surface-variant hover:bg-fm-surface-container-low disabled:opacity-40"
        >
          <span className="material-symbols-outlined text-base">attach_file</span>
        </button>
        <textarea
          ref={inputRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={clientMode ? 'Escribe un mensaje… (Enter para enviar)' : 'Escribe un mensaje interno… (Enter para enviar)'}
          rows={1}
          className="flex-1 resize-none bg-fm-background border border-fm-surface-container-high rounded-xl px-3 py-2 text-sm text-fm-on-surface outline-none focus:border-fm-primary min-h-[38px] max-h-[96px]"
          style={{ fieldSizing: 'content' } as React.CSSProperties}
        />
        {!clientMode && (
          <button
            type="button"
            onClick={() => setVisibleToClient((v) => !v)}
            title={visibleToClient ? 'Visible para el cliente (click para desactivar)' : 'Solo interno (click para hacer visible al cliente)'}
            className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border transition-colors ${
              visibleToClient
                ? 'bg-fm-primary/15 border-fm-primary text-fm-primary'
                : 'bg-fm-background border-fm-surface-container-high text-fm-on-surface-variant hover:bg-fm-surface-container-low'
            }`}
          >
            <span className="material-symbols-outlined text-base">
              {visibleToClient ? 'visibility' : 'visibility_off'}
            </span>
          </button>
        )}
        <button
          onClick={handleSend}
          disabled={(!body.trim() && !pendingFile) || sending}
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 disabled:opacity-40 transition-opacity"
          style={{ background: 'linear-gradient(135deg,#00675c,#5bf4de)' }}
        >
          {sending ? (
            <span className="material-symbols-outlined text-base text-white animate-spin">progress_activity</span>
          ) : (
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          )}
        </button>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 cursor-zoom-out"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Vista ampliada" className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </div>
  )
}
