'use client'

import Link from 'next/link'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { cn } from '@/lib/utils'
import type { Conversation, AppUser } from '@/types/db'

interface ChatHeaderProps {
  conversation: Conversation
  counterpart: Pick<AppUser, 'id' | 'full_name' | 'avatar_url'> | null
  memberCount: number
  showDetailsButton: boolean
  detailsOpen: boolean
  onToggleDetails: () => void
}

export function ChatHeader({
  conversation,
  counterpart,
  memberCount,
  showDetailsButton,
  detailsOpen,
  onToggleDetails,
}: ChatHeaderProps) {
  const isChannel = conversation.type === 'channel'

  return (
    <header className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-fm-surface-container-high bg-fm-surface-container-lowest">
      <Link
        href="/inbox"
        className="sm:hidden -ml-1 mr-2 p-1.5 rounded-lg text-fm-on-surface-variant hover:bg-fm-background flex-shrink-0"
        aria-label="Volver a la bandeja"
      >
        <span className="material-symbols-outlined text-[22px]">arrow_back</span>
      </Link>
      <div className="min-w-0 flex-1">
        {isChannel ? (
          <>
            <div className="flex items-center space-x-2">
              <span className="text-fm-primary font-bold text-lg">#</span>
              <h2 className="text-lg font-bold text-fm-on-surface truncate">{conversation.name}</h2>
            </div>
            <div className="flex items-center text-xs text-fm-on-surface-variant mt-0.5">
              <svg className="w-3.5 h-3.5 mr-1" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
              </svg>
              <span>{memberCount} miembros</span>
              {conversation.topic && (
                <>
                  <span className="mx-2">·</span>
                  <span className="truncate">{conversation.topic}</span>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center space-x-3">
            <UserAvatar
              name={counterpart?.full_name ?? '?'}
              avatarUrl={counterpart?.avatar_url}
              size="sm"
            />
            <h2 className="text-lg font-bold text-fm-on-surface">
              {counterpart?.full_name ?? 'Usuario'}
            </h2>
          </div>
        )}
      </div>
      {showDetailsButton && (
        <button
          type="button"
          onClick={onToggleDetails}
          className={cn(
            'p-2 rounded-lg transition-colors',
            detailsOpen ? 'bg-fm-primary/10 text-fm-primary' : 'text-fm-on-surface-variant hover:bg-fm-background'
          )}
          title="Detalles del canal"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11 17h2v-6h-2v6zm1-15C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zM11 9h2V7h-2v2z" />
          </svg>
        </button>
      )}
    </header>
  )
}
