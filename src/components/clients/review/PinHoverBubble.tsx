'use client'

import type { ReviewComment, UserRole } from '@/types/db'
import { UserAvatar } from '@/components/ui/UserAvatar'

interface UserMini {
  id: string
  full_name: string
  avatar_url: string | null
  role: UserRole
}

interface PinHoverBubbleProps {
  xPct: number
  yPct: number
  comment: ReviewComment
  author: UserMini | null
}

export function PinHoverBubble({ xPct, yPct, comment, author }: PinHoverBubbleProps) {
  const left = xPct > 70 ? `calc(${xPct}% - 240px)` : `${xPct}%`
  const top = yPct > 70 ? `calc(${yPct}% - 120px)` : `${yPct}%`

  return (
    <div
      className="absolute z-20 w-[240px] bg-white rounded-xl shadow-2xl ring-1 ring-black/10 p-2.5 pointer-events-none"
      style={{ left, top, transform: 'translate(8px, 8px)' }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <UserAvatar
          name={author?.full_name ?? 'Usuario'}
          avatarUrl={author?.avatar_url ?? null}
          size="xs"
        />
        <span className="text-[11px] font-semibold text-[#2a2a2a] truncate">
          {author?.full_name ?? 'Usuario'}
        </span>
      </div>
      <p
        className="text-xs text-[#2a2a2a] whitespace-pre-wrap overflow-hidden"
        style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}
      >
        {comment.body}
      </p>
    </div>
  )
}
