'use client'

import { useRef, useState } from 'react'
import {
  CheckIcon,
  RotateCcwIcon,
  MoreVerticalIcon,
  TrashIcon,
  PencilIcon,
  SendIcon,
} from 'lucide-react'
import type { ReviewPin, ReviewComment } from '@/types/db'
import {
  resolveReviewPin,
  reopenReviewPin,
  deleteReviewPin,
  addReviewCommentReply,
  editReviewComment,
  deleteReviewComment,
} from '@/app/actions/content-review'
import { MentionAutocomplete } from '@/components/requirements/MentionAutocomplete'

interface UserMini {
  id: string
  full_name: string
  avatar_url: string | null
  role: string
}

interface CommentCardProps {
  pin: ReviewPin
  comments: ReviewComment[]
  users: UserMini[]
  currentUserId: string
  clientId: string
  selected: boolean
  onSelect: () => void
  onPinUpdated: (pin: ReviewPin) => void
  onPinRemoved: (pinId: string) => void
  onCommentUpserted: (comment: ReviewComment) => void
  onCommentRemoved: (commentId: string, pinId: string) => void
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : ''
  return (first + last).toUpperCase()
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'ahora'
  if (mins < 60) return `hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `hace ${hrs} h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `hace ${days} d`
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })
}

function CommentRow({
  comment,
  userMap,
  users,
  currentUserId,
  clientId,
  onCommentUpserted,
  onCommentRemoved,
}: {
  comment: ReviewComment
  userMap: Map<string, UserMini>
  users: UserMini[]
  currentUserId: string
  clientId: string
  onCommentUpserted: (c: ReviewComment) => void
  onCommentRemoved: (id: string, pinId: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [editMentionIds, setEditMentionIds] = useState<string[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const editRef = useRef<HTMLTextAreaElement | null>(null)
  const user = comment.user_id ? userMap.get(comment.user_id) : null
  const mine = comment.user_id === currentUserId

  async function saveEdit() {
    const body = draft.trim()
    if (!body) return
    const res = await editReviewComment({ commentId: comment.id, clientId, body })
    if ('ok' in res) {
      onCommentUpserted(res.data)
      setEditing(false)
    }
  }

  async function remove() {
    const res = await deleteReviewComment({ commentId: comment.id, clientId })
    if ('ok' in res) {
      onCommentRemoved(comment.id, comment.pin_id)
    }
  }

  return (
    <div className="flex gap-2">
      <div className="flex-shrink-0">
        {user?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatar_url}
            alt={user.full_name}
            className="w-6 h-6 rounded-full object-cover"
          />
        ) : (
          <div className="w-6 h-6 rounded-full bg-[#00675c] text-white text-[10px] font-semibold flex items-center justify-center">
            {initialsOf(user?.full_name ?? '?')}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-xs font-semibold text-[#2a2a2a] truncate">
            {user?.full_name ?? 'Usuario'}
          </span>
          <span className="text-[10px] text-[#8a8f93]">· {formatWhen(comment.created_at)}</span>
          {comment.edited_at && (
            <span className="text-[10px] text-[#8a8f93] italic">(editado)</span>
          )}
          {mine && !editing && (
            <div className="relative ml-auto">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="p-0.5 rounded hover:bg-[#f5f7f9] text-[#8a8f93]"
                aria-label="Opciones"
              >
                <MoreVerticalIcon className="w-3.5 h-3.5" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-5 z-10 bg-white rounded-md shadow-lg ring-1 ring-black/10 py-1 min-w-[120px]">
                  <button
                    onClick={() => {
                      setEditing(true)
                      setMenuOpen(false)
                    }}
                    className="w-full px-3 py-1.5 text-left text-xs hover:bg-[#f5f7f9] flex items-center gap-2"
                  >
                    <PencilIcon className="w-3 h-3" />
                    Editar
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      remove()
                    }}
                    className="w-full px-3 py-1.5 text-left text-xs hover:bg-[#f5f7f9] text-[#b31b25] flex items-center gap-2"
                  >
                    <TrashIcon className="w-3 h-3" />
                    Eliminar
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {editing ? (
          <div className="mt-1 relative">
            <MentionAutocomplete
              textareaRef={editRef}
              value={draft}
              onChange={setDraft}
              users={users}
              currentMentionIds={editMentionIds}
              onMentionsChange={setEditMentionIds}
            />
            <textarea
              ref={editRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              className="w-full text-xs text-[#2a2a2a] bg-[#f5f7f9] rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
            />
            <div className="flex gap-1 mt-1 justify-end">
              <button
                onClick={() => {
                  setEditing(false)
                  setDraft(comment.body)
                }}
                className="px-2 py-0.5 text-[11px] rounded hover:bg-[#f5f7f9] text-[#595c5e]"
              >
                Cancelar
              </button>
              <button
                onClick={saveEdit}
                disabled={!draft.trim()}
                className="px-2 py-0.5 text-[11px] rounded bg-[#00675c] text-white disabled:opacity-40"
              >
                Guardar
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-[#2a2a2a] whitespace-pre-wrap break-words mt-0.5">
            {comment.body}
          </p>
        )}
      </div>
    </div>
  )
}

export function CommentCard({
  pin,
  comments,
  users,
  currentUserId,
  clientId,
  selected,
  onSelect,
  onPinUpdated,
  onPinRemoved,
  onCommentUpserted,
  onCommentRemoved,
}: CommentCardProps) {
  const userMap = new Map(users.map((u) => [u.id, u]))
  const root = comments.find((c) => c.parent_id == null) ?? comments[0]
  const replies = comments.filter((c) => c.id !== root?.id)
  const [replyOpen, setReplyOpen] = useState(false)
  const [replyBody, setReplyBody] = useState('')
  const [replyMentionIds, setReplyMentionIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const replyRef = useRef<HTMLTextAreaElement | null>(null)

  async function toggleResolved() {
    setBusy(true)
    const res =
      pin.status === 'active'
        ? await resolveReviewPin({ pinId: pin.id, clientId })
        : await reopenReviewPin({ pinId: pin.id, clientId })
    setBusy(false)
    if ('ok' in res) {
      onPinUpdated({
        ...pin,
        status: pin.status === 'active' ? 'resolved' : 'active',
        resolved_by: pin.status === 'active' ? currentUserId : null,
        resolved_at: pin.status === 'active' ? new Date().toISOString() : null,
      })
    }
  }

  async function removePin() {
    if (!confirm('¿Eliminar este pin y todos sus comentarios?')) return
    setBusy(true)
    const res = await deleteReviewPin({ pinId: pin.id, clientId })
    setBusy(false)
    if ('ok' in res) {
      onPinRemoved(pin.id)
    }
  }

  async function submitReply() {
    const body = replyBody.trim()
    if (!body || !root) return
    setBusy(true)
    const res = await addReviewCommentReply({
      pinId: pin.id,
      parentId: root.id,
      clientId,
      body,
      mentionedUserIds: replyMentionIds,
    })
    setBusy(false)
    if ('ok' in res) {
      onCommentUpserted(res.data)
      setReplyBody('')
      setReplyMentionIds([])
      setReplyOpen(false)
    }
  }

  if (!root) return null

  const mine = root.user_id === currentUserId

  return (
    <div
      onClick={onSelect}
      className={`rounded-lg border p-2.5 cursor-pointer transition-all ${
        selected
          ? 'border-[#00675c] bg-[#00675c]/5 shadow-sm'
          : 'border-[#dfe3e6] hover:border-[#8a8f93] bg-white'
      }`}
    >
      <div className="flex items-start gap-2 mb-1.5">
        <div className="w-5 h-5 rounded-full bg-[#00675c] text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
          {pin.pin_number}
        </div>
        <div className="flex-1 min-w-0">
          <CommentRow
            comment={root}
            userMap={userMap}
            users={users}
            currentUserId={currentUserId}
            clientId={clientId}
            onCommentUpserted={onCommentUpserted}
            onCommentRemoved={onCommentRemoved}
          />
        </div>
      </div>

      {replies.length > 0 && (
        <div className="ml-7 space-y-2 pl-2 border-l-2 border-[#dfe3e6]">
          {replies.map((r) => (
            <CommentRow
              key={r.id}
              comment={r}
              userMap={userMap}
              users={users}
              currentUserId={currentUserId}
              clientId={clientId}
              onCommentUpserted={onCommentUpserted}
              onCommentRemoved={onCommentRemoved}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-1 mt-2 pl-7">
        <button
          onClick={(e) => {
            e.stopPropagation()
            toggleResolved()
          }}
          disabled={busy}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition-colors disabled:opacity-40 ${
            pin.status === 'active'
              ? 'text-[#00675c] hover:bg-[#00675c]/10'
              : 'text-[#595c5e] hover:bg-[#f5f7f9]'
          }`}
        >
          {pin.status === 'active' ? (
            <>
              <CheckIcon className="w-3 h-3" />
              Resolver
            </>
          ) : (
            <>
              <RotateCcwIcon className="w-3 h-3" />
              Reabrir
            </>
          )}
        </button>
        {!replyOpen && pin.status === 'active' && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setReplyOpen(true)
            }}
            className="px-2 py-1 rounded text-[11px] font-semibold text-[#595c5e] hover:bg-[#f5f7f9]"
          >
            Responder
          </button>
        )}
        {mine && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              removePin()
            }}
            disabled={busy}
            className="ml-auto px-2 py-1 rounded text-[11px] font-semibold text-[#b31b25] hover:bg-[#b31b25]/10 disabled:opacity-40"
          >
            Eliminar
          </button>
        )}
      </div>

      {replyOpen && (
        <div
          className="mt-2 pl-7"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative">
            <MentionAutocomplete
              textareaRef={replyRef}
              value={replyBody}
              onChange={setReplyBody}
              users={users}
              currentMentionIds={replyMentionIds}
              onMentionsChange={setReplyMentionIds}
            />
            <textarea
              ref={replyRef}
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submitReply()
                }
                if (e.key === 'Escape') setReplyOpen(false)
              }}
              placeholder="Escribir respuesta... (@ para mencionar)"
              rows={2}
              autoFocus
              className="w-full text-xs text-[#2a2a2a] bg-[#f5f7f9] rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
            />
          </div>
          <div className="flex justify-end gap-1 mt-1">
            <button
              onClick={() => setReplyOpen(false)}
              className="px-2 py-0.5 text-[11px] rounded hover:bg-[#f5f7f9] text-[#595c5e]"
            >
              Cancelar
            </button>
            <button
              onClick={submitReply}
              disabled={!replyBody.trim() || busy}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-[#00675c] text-white disabled:opacity-40"
            >
              <SendIcon className="w-3 h-3" />
              Enviar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
