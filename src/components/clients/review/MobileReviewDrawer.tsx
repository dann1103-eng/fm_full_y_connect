'use client'

import type { ReviewPin, ReviewComment, UserRole } from '@/types/db'
import { ReviewRightColumn } from './ReviewRightColumn'

interface UserMini {
  id: string
  full_name: string
  avatar_url: string | null
  role: UserRole
}

interface MobileReviewDrawerProps {
  open: boolean
  onToggle: () => void
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

export function MobileReviewDrawer({
  open,
  onToggle,
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
}: MobileReviewDrawerProps) {
  const activePinCount = pins.filter((p) => p.status === 'active').length

  return (
    <div
      className={`md:hidden absolute bottom-0 left-0 right-0 z-20 flex flex-col bg-fm-surface-container-lowest border-t border-fm-surface-container-high transition-transform duration-300 ease-in-out ${
        open ? 'translate-y-0' : 'translate-y-[calc(100%-44px)]'
      }`}
      style={{ maxHeight: '60vh' }}
    >
      {/* Handle / toggle bar */}
      <button type="button"
        onClick={onToggle}
        className="flex items-center justify-between px-4 min-h-[44px] flex-shrink-0 hover:bg-fm-surface-container/50 transition-colors"
      >
        <span className="text-xs text-fm-on-surface-variant">
          {activePinCount > 0
            ? `${activePinCount} pin${activePinCount !== 1 ? 'es' : ''}`
            : 'Sin pines'}
        </span>
        <span className="text-xs text-fm-primary font-medium">
          {open ? '▼ Ocultar' : '▲ Ver pines'}
        </span>
      </button>

      {/* Content */}
      {open && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <ReviewRightColumn
            pins={pins}
            commentsByPin={commentsByPin}
            selectedPinId={selectedPinId}
            onSelectPin={onSelectPin}
            clientId={clientId}
            currentUserId={currentUserId}
            users={users}
            onPinUpdated={onPinUpdated}
            onPinRemoved={onPinRemoved}
            onCommentUpserted={onCommentUpserted}
            onCommentRemoved={onCommentRemoved}
            clientMode={clientMode}
          />
        </div>
      )}
    </div>
  )
}
