'use client'

import { useState, useTransition } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { AttachmentPreview } from './AttachmentPreview'
import { editMessage, deleteMessage, deleteAttachment } from '@/app/actions/inbox'
import { RequirementShareCard, parseReqShareBody } from './RequirementShareCard'
import type { MessageWithMeta } from '@/types/db'

interface MessageItemProps {
  message: MessageWithMeta
  currentUserId: string
  isAdmin?: boolean
  onUpdated: (patch: Partial<MessageWithMeta>) => void
  onDeleted: () => void
}

export function MessageItem({ message, currentUserId, isAdmin = false, onUpdated, onDeleted }: MessageItemProps) {
  const isMine = message.user_id === currentUserId
  const canDelete = isMine || isAdmin
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.body)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const time = (() => {
    try {
      return format(parseISO(message.created_at), 'p', { locale: es })
    } catch {
      return ''
    }
  })()

  function save() {
    startTransition(async () => {
      const res = await editMessage({ messageId: message.id, body: draft })
      if ('error' in res && res.error) {
        setError(res.error)
        return
      }
      onUpdated({ body: draft.trim(), edited_at: new Date().toISOString() })
      setEditing(false)
      setError(null)
    })
  }

  function remove() {
    if (!confirm('¿Eliminar este mensaje?')) return
    startTransition(async () => {
      const res = await deleteMessage(message.id)
      if ('error' in res && res.error) {
        setError(res.error)
        return
      }
      onDeleted()
    })
  }

  async function handleAttachmentDelete(attachmentId: string) {
    if (!confirm('¿Eliminar este adjunto?')) return
    startTransition(async () => {
      const res = await deleteAttachment(attachmentId)
      if ('error' in res && res.error) {
        setError(res.error)
        return
      }
      onUpdated({ attachments: message.attachments.filter((a) => a.id !== attachmentId) })
    })
  }

  return (
    <div
      className={cn('flex items-start gap-3 group', isMine && 'flex-row-reverse')}
    >
      <UserAvatar
        name={message.author?.full_name ?? '?'}
        avatarUrl={message.author?.avatar_url}
        size="sm"
      />
      <div className={cn('flex-1 min-w-0 space-y-1', isMine && 'flex flex-col items-end')}>
        <div className={cn('flex items-baseline gap-2', isMine && 'flex-row-reverse')}>
          <span className="font-bold text-sm text-fm-on-surface">
            {isMine ? 'Tú' : message.author?.full_name ?? 'Usuario eliminado'}
          </span>
          <span className="text-[10px] text-fm-on-surface-variant/70">{time}</span>
          {message.edited_at && (
            <span className="text-[10px] text-fm-on-surface-variant/70 italic">(editado)</span>
          )}
        </div>

        {editing ? (
          <div className="max-w-[80%]">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              className="w-full text-sm border border-fm-surface-container-high rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
            />
            <div className="flex items-center gap-2 mt-1 text-xs">
              <button
                onClick={save}
                disabled={pending || !draft.trim()}
                className="text-fm-primary font-semibold disabled:opacity-50"
              >
                Guardar
              </button>
              <button
                onClick={() => {
                  setDraft(message.body)
                  setEditing(false)
                }}
                className="text-fm-on-surface-variant"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (() => {
          const share = parseReqShareBody(message.body)
          if (share) {
            return (
              <RequirementShareCard
                requirementId={share.requirementId}
                title={share.title}
                isMine={isMine}
              />
            )
          }
          return (
            message.body.trim() !== '' && (
              <div
                className={cn(
                  'p-3 rounded-lg text-sm max-w-[80%] break-words whitespace-pre-wrap',
                  isMine
                    ? 'bg-fm-primary text-white rounded-tr-none'
                    : 'bg-fm-surface-container-lowest border border-fm-surface-container-high text-fm-on-surface rounded-tl-none'
                )}
              >
                {message.body}
              </div>
            )
          )
        })()}

        {message.attachments.length > 0 && (
          <div className={cn('space-y-1', isMine && 'flex flex-col items-end')}>
            {message.attachments.map((a) => (
              <AttachmentPreview
                key={a.id}
                attachment={a}
                onDelete={isMine ? () => handleAttachmentDelete(a.id) : undefined}
              />
            ))}
          </div>
        )}

        {error && <div className="text-[10px] text-fm-error">{error}</div>}

        {!editing && (isMine || canDelete) && (
          <div className="flex items-center gap-2 text-[10px] text-fm-on-surface-variant/70 opacity-0 group-hover:opacity-100 transition-opacity">
            {isMine && (
              <button onClick={() => setEditing(true)} className="hover:text-fm-primary">
                Editar
              </button>
            )}
            {canDelete && (
              <button onClick={remove} disabled={pending} className="hover:text-fm-error">
                Eliminar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
