'use client'

import { useMemo, useState } from 'react'
import type { ReviewPin, ReviewComment, UserRole } from '@/types/db'
import { CommentCard } from './CommentCard'

type Tab = 'active' | 'resolved'

interface UserMini {
  id: string
  full_name: string
  avatar_url: string | null
  role: UserRole
}

interface ReviewRightColumnProps {
  pins: ReviewPin[]
  commentsByPin: Record<string, ReviewComment[]>
  selectedPinId: string | null
  onSelectPin: (id: string | null) => void
  clientId: string
  currentUserId: string
  users: UserMini[]
  onPinUpdated: (pin: ReviewPin) => void
  onPinRemoved: (pinId: string) => void
  onCommentUpserted: (comment: ReviewComment) => void
  onCommentRemoved: (commentId: string, pinId: string) => void
  clientMode?: boolean
}

export function ReviewRightColumn({
  pins,
  commentsByPin,
  selectedPinId,
  onSelectPin,
  clientId,
  currentUserId,
  users,
  onPinUpdated,
  onPinRemoved,
  onCommentUpserted,
  onCommentRemoved,
  clientMode = false,
}: ReviewRightColumnProps) {
  const [tab, setTab] = useState<Tab>('active')

  const active = useMemo(
    () => pins.filter((p) => p.status === 'active'),
    [pins]
  )
  const resolved = useMemo(
    () => pins.filter((p) => p.status === 'resolved'),
    [pins]
  )

  const list = tab === 'active' ? active : resolved

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-fm-surface-container-high flex-shrink-0">
        <button
          onClick={() => setTab('active')}
          className={`flex-1 text-xs font-semibold py-3 transition-colors ${
            tab === 'active'
              ? 'text-fm-primary border-b-2 border-fm-primary'
              : 'text-fm-on-surface-variant hover:text-fm-on-surface'
          }`}
        >
          Activo {active.length > 0 && <span className="ml-1">({active.length})</span>}
        </button>
        <button
          onClick={() => setTab('resolved')}
          className={`flex-1 text-xs font-semibold py-3 transition-colors ${
            tab === 'resolved'
              ? 'text-fm-primary border-b-2 border-fm-primary'
              : 'text-fm-on-surface-variant hover:text-fm-on-surface'
          }`}
        >
          Resuelto{' '}
          {resolved.length > 0 && <span className="ml-1">({resolved.length})</span>}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {list.length === 0 ? (
          <div className="text-center text-xs text-fm-on-surface-variant py-8">
            {tab === 'active'
              ? 'Aún no hay comentarios. Haz clic sobre la imagen o video para crear uno.'
              : 'Nada resuelto todavía.'}
          </div>
        ) : (
          list.map((pin) => (
            <CommentCard
              key={pin.id}
              pin={pin}
              comments={commentsByPin[pin.id] ?? []}
              users={users}
              currentUserId={currentUserId}
              clientId={clientId}
              selected={pin.id === selectedPinId}
              onSelect={() => onSelectPin(pin.id)}
              onPinUpdated={onPinUpdated}
              onPinRemoved={onPinRemoved}
              onCommentUpserted={onCommentUpserted}
              onCommentRemoved={onCommentRemoved}
              clientMode={clientMode}
            />
          ))
        )}
      </div>
    </div>
  )
}
