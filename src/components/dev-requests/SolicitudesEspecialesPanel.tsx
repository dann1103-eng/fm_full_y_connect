'use client'

import { useState, useTransition } from 'react'
import { updateDevRequestStatus, addDevRequestNote, createDevRequest } from '@/app/actions/devRequests'
import type { DevRequestWithNotes, DevRequestNote, DevRequestStatus } from '@/types/db'
import { DEV_REQUEST_STATUS_LABELS } from '@/types/db'

// ─── Status styles ────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<DevRequestStatus, string> = {
  pending:     'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  in_progress: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  done:        'bg-fm-primary/10 text-fm-primary border-fm-primary/20',
  rejected:    'bg-fm-error/10 text-fm-error border-fm-error/20',
}

const NEXT_STATUSES: Record<DevRequestStatus, DevRequestStatus[]> = {
  pending:     ['in_progress', 'done', 'rejected'],
  in_progress: ['done', 'rejected', 'pending'],
  done:        ['pending'],
  rejected:    ['pending'],
}

function StatusChip({ status }: { status: DevRequestStatus }) {
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATUS_STYLES[status]}`}>
      {DEV_REQUEST_STATUS_LABELS[status]}
    </span>
  )
}

// ─── Nota individual ──────────────────────────────────────────────────────────

function NoteItem({ note, currentUserId }: { note: DevRequestNote; currentUserId: string }) {
  const isMine = note.created_by === currentUserId
  const date = new Date(note.created_at).toLocaleDateString('es-SV', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
  return (
    <div className={`flex gap-2 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
        isMine
          ? 'bg-fm-primary/10 text-fm-on-surface rounded-tr-sm'
          : 'bg-fm-surface-container-high text-fm-on-surface rounded-tl-sm'
      }`}>
        {note.content}
        <p className="text-[10px] text-fm-on-surface-variant mt-1 opacity-70">{date}</p>
      </div>
    </div>
  )
}

// ─── Formulario de nota ───────────────────────────────────────────────────────

function NoteForm({ requestId }: { requestId: string }) {
  const [text, setText] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setError(null)
    startTransition(async () => {
      const res = await addDevRequestNote(requestId, text)
      if ('error' in res) { setError(res.error); return }
      setText('')
    })
  }

  return (
    <form onSubmit={submit} className="flex gap-2 mt-3 pt-3 border-t border-fm-surface-container-high">
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Agregar nota de seguimiento…"
        disabled={isPending}
        className="flex-1 rounded-xl border border-fm-outline-variant/40 bg-fm-background px-3 py-1.5 text-sm text-fm-on-surface placeholder:text-fm-outline-variant focus:outline-none focus:border-fm-primary disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={isPending || !text.trim()}
        className="shrink-0 px-3 py-1.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-opacity"
        style={{ background: 'linear-gradient(135deg,#00675c,#5bf4de)' }}
      >
        <span className="material-symbols-outlined text-[18px] align-middle">send</span>
      </button>
      {error && <p className="text-xs text-fm-error mt-1 w-full">{error}</p>}
    </form>
  )
}

// ─── Tarjeta de solicitud ─────────────────────────────────────────────────────

function RequestCard({
  request,
  currentUserId,
}: {
  request: DevRequestWithNotes
  currentUserId: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [status, setStatus] = useState<DevRequestStatus>(request.status as DevRequestStatus)
  const [statusOpen, setStatusOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const date = new Date(request.created_at).toLocaleDateString('es-SV', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  function changeStatus(next: DevRequestStatus) {
    setStatusOpen(false)
    startTransition(async () => {
      const res = await updateDevRequestStatus(request.id, next)
      if ('ok' in res) setStatus(next)
    })
  }

  return (
    <div className={`bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 transition-opacity ${isPending ? 'opacity-60' : ''}`}>
      {/* Header de la tarjeta */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left p-4 flex items-start gap-3 hover:bg-fm-background/50 rounded-2xl transition-colors"
      >
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-fm-on-surface leading-snug">{request.title}</span>
          </div>
          <p className={`text-xs text-fm-on-surface-variant leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
            {request.description}
          </p>
          <div className="flex items-center gap-2 flex-wrap pt-0.5">
            <span className="text-[11px] text-fm-on-surface-variant">{date}</span>
            {request.notes.length > 0 && (
              <span className="text-[11px] text-fm-on-surface-variant flex items-center gap-0.5">
                <span className="material-symbols-outlined text-[13px]">chat_bubble</span>
                {request.notes.length}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 flex flex-col items-end gap-2">
          {/* Status chip — el destinatario puede cambiarlo */}
          <div className="relative" onClick={e => e.stopPropagation()}>
            {request.is_recipient ? (
              <button
                onClick={() => setStatusOpen(v => !v)}
                className="flex items-center gap-1 hover:opacity-80 transition-opacity"
                disabled={isPending}
              >
                <StatusChip status={status} />
                <span className="text-fm-outline-variant text-xs">▾</span>
              </button>
            ) : (
              <StatusChip status={status} />
            )}
            {statusOpen && (
              <div className="absolute right-0 top-full mt-1 z-10 bg-fm-surface-container-lowest border border-fm-outline-variant/30 rounded-xl shadow-lg overflow-hidden min-w-[140px]">
                {NEXT_STATUSES[status].map(s => (
                  <button
                    key={s}
                    onClick={() => changeStatus(s)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-fm-background"
                  >
                    <StatusChip status={s} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="material-symbols-outlined text-[18px] text-fm-outline-variant">
            {expanded ? 'expand_less' : 'expand_more'}
          </span>
        </div>
      </button>

      {/* Contenido expandido: retribución + notas */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-fm-surface-container-high pt-3">
          {/* Retribución */}
          <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl px-3 py-2">
            <span className="text-base">💰</span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Retribución prometida
              </p>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                {request.compensation_method}
              </p>
            </div>
          </div>

          {/* Hilo de notas */}
          {request.notes.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-fm-on-surface-variant">
                Notas de seguimiento
              </p>
              {request.notes.map(n => (
                <NoteItem key={n.id} note={n} currentUserId={currentUserId} />
              ))}
            </div>
          )}

          <NoteForm requestId={request.id} />
        </div>
      )}
    </div>
  )
}

// ─── Formulario nueva solicitud ───────────────────────────────────────────────

function NewRequestForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [compensation, setCompensation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await createDevRequest({
        title,
        description,
        compensation_method: compensation,
      })
      if ('error' in res) { setError(res.error); return }
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-fm-on-surface-variant mb-1.5">
          Título <span className="text-fm-error">*</span>
        </label>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} required
          placeholder="¿Qué necesitas?"
          className="w-full rounded-xl border border-fm-outline-variant/40 bg-fm-background px-3 py-2.5 text-sm text-fm-on-surface placeholder:text-fm-outline-variant focus:outline-none focus:border-fm-primary"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-fm-on-surface-variant mb-1.5">
          Descripción <span className="text-fm-error">*</span>
        </label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} required rows={3}
          placeholder="Detalla la solicitud…"
          className="w-full rounded-xl border border-fm-outline-variant/40 bg-fm-background px-3 py-2.5 text-sm text-fm-on-surface placeholder:text-fm-outline-variant focus:outline-none focus:border-fm-primary resize-none"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-fm-on-surface-variant mb-1.5">
          Retribución <span className="text-fm-error">*</span>
        </label>
        <input type="text" value={compensation} onChange={e => setCompensation(e.target.value)} required
          placeholder="Café ☕, almuerzo 🍔, gratitud eterna 🙏…"
          className="w-full rounded-xl border border-fm-outline-variant/40 bg-fm-background px-3 py-2.5 text-sm text-fm-on-surface placeholder:text-fm-outline-variant focus:outline-none focus:border-fm-primary"
        />
      </div>
      {error && (
        <p className="text-sm text-fm-error bg-fm-error/5 border border-fm-error/20 rounded-xl px-3 py-2">{error}</p>
      )}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onDone}
          className="flex-1 text-sm font-medium text-fm-on-surface-variant border border-fm-outline-variant/40 px-4 py-2.5 rounded-xl hover:bg-fm-background"
        >
          Cancelar
        </button>
        <button type="submit" disabled={isPending}
          className="flex-1 text-sm font-semibold text-white px-4 py-2.5 rounded-xl disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#00675c,#5bf4de)' }}
        >
          {isPending ? 'Enviando…' : 'Enviar 🚀'}
        </button>
      </div>
    </form>
  )
}

// ─── Panel principal ──────────────────────────────────────────────────────────

interface Props {
  received: DevRequestWithNotes[]
  sent: DevRequestWithNotes[]
  currentUserId: string
}

export function SolicitudesEspecialesPanel({ received, sent, currentUserId }: Props) {
  const [tab, setTab] = useState<'received' | 'sent'>('received')
  const [showForm, setShowForm] = useState(false)

  const items = tab === 'received' ? received : sent
  const pendingReceived = received.filter(r => r.status === 'pending').length

  return (
    <div className="space-y-4">
      {/* Barra superior: tabs + botón nueva */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 bg-fm-surface-container-high rounded-xl p-1">
          <TabButton active={tab === 'received'} onClick={() => setTab('received')} badge={pendingReceived}>
            Para mí
          </TabButton>
          <TabButton active={tab === 'sent'} onClick={() => setTab('sent')}>
            Enviadas
          </TabButton>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 text-sm font-semibold text-white px-3 py-2 rounded-xl"
          style={{ background: 'linear-gradient(135deg,#00675c,#5bf4de)' }}
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Nueva
        </button>
      </div>

      {/* Formulario de nueva solicitud (inline) */}
      {showForm && (
        <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-4 sm:p-5">
          <p className="text-sm font-semibold text-fm-on-surface mb-4">Nueva solicitud ✍️</p>
          <NewRequestForm onDone={() => setShowForm(false)} />
        </div>
      )}

      {/* Lista */}
      {items.length === 0 ? (
        <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-10 text-center">
          <p className="text-2xl mb-2">{tab === 'received' ? '📬' : '📤'}</p>
          <p className="text-sm font-medium text-fm-on-surface">
            {tab === 'received' ? 'Ninguna solicitud para ti todavía.' : 'No has enviado solicitudes aún.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(r => (
            <RequestCard key={r.id} request={r} currentUserId={currentUserId} />
          ))}
        </div>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
  badge,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  badge?: number
}) {
  return (
    <button
      onClick={onClick}
      className={`relative px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
        active
          ? 'bg-fm-surface-container-lowest text-fm-on-surface shadow-sm'
          : 'text-fm-on-surface-variant hover:text-fm-on-surface'
      }`}
    >
      {children}
      {!!badge && (
        <span className="absolute -top-1 -right-1 bg-fm-error text-white text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  )
}
