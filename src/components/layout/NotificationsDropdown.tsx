'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { XIcon } from 'lucide-react'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { useNotifications } from '@/hooks/useNotifications'
import {
  markAllMentionsRead,
  markMentionRead,
  markReviewMentionRead,
} from '@/app/actions/requirement-messages'
import { markAllConversationsRead, markConversationRead } from '@/app/actions/inbox'
import type { NotificationItem } from '@/types/db'

export function NotificationsDropdown() {
  const router = useRouter()
  const { items, allItems, unreadCount, refresh, dismissOverdue, dismissAllOverdue } = useNotifications()
  const [open, setOpen] = useState(false)
  const [, startTransition] = useTransition()

  function handleToggle() {
    setOpen((v) => !v)
  }

  function buildRequirementMentionHref(item: NotificationItem): string {
    if (item.mention_source === 'review' && item.client_id && item.requirement_id) {
      const params = new URLSearchParams()
      params.set('req', item.requirement_id)
      params.set('tab', 'revision')
      if (item.review_pin_id) params.set('pin', item.review_pin_id)
      return `/clients/${item.client_id}?${params.toString()}`
    }
    if (item.requirement_id) {
      return `/pipeline?req=${item.requirement_id}`
    }
    return '/pipeline'
  }

  function handleItemClick(item: NotificationItem) {
    setOpen(false)
    if (item.kind === 'overdue' && item.overdue_requirement_id) {
      router.push(`/pipeline?req=${item.overdue_requirement_id}`)
      return
    }
    if (item.kind === 'mention') {
      startTransition(async () => {
        if (item.mention_source === 'review') {
          await markReviewMentionRead(item.id)
        } else {
          await markMentionRead(item.id)
        }
        refresh()
      })
      router.push(buildRequirementMentionHref(item))
      return
    }
    if (item.conversation_id) {
      router.push(`/inbox/${item.conversation_id}`)
    }
  }

  function handleDismiss(item: NotificationItem) {
    if (item.kind === 'overdue' && item.overdue_requirement_id) {
      dismissOverdue(item.overdue_requirement_id, item.created_at)
      return
    }
    if (item.kind === 'mention') {
      startTransition(async () => {
        if (item.mention_source === 'review') {
          await markReviewMentionRead(item.id)
        } else {
          await markMentionRead(item.id)
        }
        refresh()
      })
      return
    }
    if (item.conversation_id) {
      startTransition(async () => {
        await markConversationRead(item.conversation_id!)
        refresh()
      })
    }
  }

  function handleMarkAll() {
    dismissAllOverdue()
    startTransition(async () => {
      await Promise.all([markAllMentionsRead(), markAllConversationsRead()])
      await refresh()
      setOpen(false)
    })
  }

  const hasItems = items.length > 0
  const overdueCount = allItems.filter((it) => it.kind === 'overdue').length

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        className="relative w-9 h-9 flex items-center justify-center rounded-full hover:bg-fm-background transition-colors"
        aria-label="Notificaciones"
      >
        <span className="material-symbols-outlined text-[22px] text-fm-on-surface">notifications</span>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-fm-error text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-[360px] max-w-[calc(100vw-2rem)] bg-fm-surface-container-lowest rounded-xl shadow-xl ring-1 ring-black/10 overflow-hidden flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-fm-surface-container-high">
              <div className="text-sm font-bold text-fm-on-surface">Notificaciones</div>
              {hasItems && (
                <button
                  type="button"
                  onClick={handleMarkAll}
                  className="text-[11px] font-semibold text-fm-primary hover:underline whitespace-nowrap"
                >
                  Marcar todo leído
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="py-10 text-center text-sm text-fm-on-surface-variant/70">
                  No tienes notificaciones pendientes.
                </div>
              ) : (
                items.map((item) => (
                  <NotificationRow
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    onClick={() => handleItemClick(item)}
                    onDismiss={() => handleDismiss(item)}
                  />
                ))
              )}
            </div>

            {overdueCount > 0 && (
              <div className="border-t border-fm-surface-container-high px-4 py-2.5">
                <Link
                  href="/pipeline"
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between text-[11px] font-semibold text-fm-error hover:underline"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px]">warning</span>
                    Ver {overdueCount} vencido{overdueCount !== 1 ? 's' : ''} en Pipeline
                  </span>
                  <span>→</span>
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function NotificationRow({
  item,
  onClick,
  onDismiss,
}: {
  item: NotificationItem
  onClick: () => void
  onDismiss: () => void
}) {
  const timeAgo = (() => {
    try {
      return formatDistanceToNow(parseISO(item.created_at), { locale: es, addSuffix: false })
    } catch {
      return ''
    }
  })()

  const isOverdue = item.kind === 'overdue'
  const isMention = item.kind === 'mention'
  const isReviewMention = isMention && item.mention_source === 'review'

  function handleDismissClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    onDismiss()
  }

  const dismissButton = (
    <button
      type="button"
      onClick={handleDismissClick}
      aria-label="Descartar notificación"
      className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-fm-on-surface-variant/60 hover:bg-black/10 hover:text-fm-on-surface transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
    >
      <XIcon className="w-3 h-3" />
    </button>
  )

  if (isOverdue) {
    return (
      <div className="relative group">
        <button
          type="button"
          onClick={onClick}
          className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-fm-error/10 transition-colors border-b border-fm-surface-container-high/60 last:border-b-0 bg-fm-error/5 border-l-4 border-l-fm-error"
        >
          <span className="w-8 h-8 rounded-full bg-fm-error/10 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[18px] text-fm-error">warning</span>
          </span>
          <div className="flex-1 min-w-0 pr-5">
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs leading-tight">
                <span className="font-bold text-fm-error uppercase tracking-wide text-[10px]">Vencido</span>
                {item.overdue_days != null && item.overdue_days > 0 && (
                  <span className="ml-1 text-[10px] text-fm-error/80">
                    hace {item.overdue_days}d
                  </span>
                )}
                <div className="font-semibold text-fm-on-surface mt-0.5 truncate">
                  {item.overdue_requirement_title}
                </div>
                {item.overdue_client_name && (
                  <div className="text-fm-on-surface-variant/70 text-[11px]">{item.overdue_client_name}</div>
                )}
              </div>
            </div>
          </div>
        </button>
        {dismissButton}
      </div>
    )
  }

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        className={
          'w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-fm-background transition-colors border-b border-fm-surface-container-high/60 last:border-b-0 ' +
          (isMention && !item.read ? 'bg-fm-primary/5 border-l-2 border-l-fm-primary' : '')
        }
      >
        {isMention ? (
          <UserAvatar
            name={item.mentioned_by?.full_name ?? '?'}
            avatarUrl={item.mentioned_by?.avatar_url ?? null}
            size="sm"
          />
        ) : item.conversation_type === 'channel' ? (
          <span className="w-8 h-8 rounded-full bg-fm-primary/10 flex items-center justify-center text-fm-primary font-bold flex-shrink-0">
            #
          </span>
        ) : (
          <UserAvatar
            name={item.counterpart?.full_name ?? '?'}
            avatarUrl={item.counterpart?.avatar_url ?? null}
            size="sm"
          />
        )}

        <div className="flex-1 min-w-0 pr-5">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs text-fm-on-surface-variant leading-tight">
              {isMention ? (
                <>
                  <span className="font-semibold text-fm-primary">
                    @{item.mentioned_by?.full_name ?? 'Alguien'}
                  </span>{' '}
                  te mencionó en{' '}
                  <span className="font-semibold text-fm-on-surface">
                    {isReviewMention && item.review_asset_name
                      ? `${item.requirement_title ?? 'un requerimiento'} · ${item.review_asset_name}`
                      : item.requirement_title ?? 'un requerimiento'}
                  </span>
                  {isReviewMention && (
                    <span className="ml-1 text-[10px] font-semibold text-fm-primary/70 uppercase">· revisión</span>
                  )}
                </>
              ) : item.conversation_type === 'channel' ? (
                <span className="font-semibold text-fm-on-surface">
                  #{item.conversation_name ?? 'canal'}
                </span>
              ) : (
                <span className="font-semibold text-fm-on-surface">
                  {item.counterpart?.full_name ?? 'Mensaje directo'}
                </span>
              )}
            </div>
            <span className="text-[10px] text-fm-on-surface-variant/60 flex-shrink-0 whitespace-nowrap">
              {timeAgo}
            </span>
          </div>

          {(item.message_preview || item.last_message_preview) && (
            <div className="text-xs text-fm-on-surface mt-1 line-clamp-2">
              {item.message_preview ?? item.last_message_preview}
            </div>
          )}

          {!isMention && (item.unread_count ?? 0) > 0 && (
            <div className="mt-1">
              <span className="inline-flex items-center min-w-[18px] h-[18px] px-1.5 bg-fm-error text-white text-[10px] font-bold rounded-full">
                {(item.unread_count ?? 0) > 99 ? '99+' : item.unread_count}
              </span>
            </div>
          )}
        </div>
      </button>
      {dismissButton}
    </div>
  )
}
