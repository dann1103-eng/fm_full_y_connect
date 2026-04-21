'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { useNotifications } from '@/hooks/useNotifications'
import { markAllMentionsRead, markMentionRead } from '@/app/actions/requirement-messages'
import { markAllConversationsRead } from '@/app/actions/inbox'
import type { NotificationItem } from '@/types/db'

export function NotificationsDropdown() {
  const router = useRouter()
  const { items, unreadCount, refresh } = useNotifications()
  const [open, setOpen] = useState(false)
  const [, startTransition] = useTransition()

  function handleItemClick(item: NotificationItem) {
    setOpen(false)
    if (item.kind === 'overdue' && item.overdue_requirement_id) {
      router.push(`/pipeline?req=${item.overdue_requirement_id}`)
      return
    }
    if (item.kind === 'mention' && item.requirement_id) {
      startTransition(async () => {
        await markMentionRead(item.id)
        refresh()
      })
      router.push(`/pipeline?req=${item.requirement_id}`)
      return
    }
    if (item.conversation_id) {
      router.push(`/inbox/${item.conversation_id}`)
    }
  }

  function handleMarkAll() {
    startTransition(async () => {
      await Promise.all([markAllMentionsRead(), markAllConversationsRead()])
      refresh()
    })
  }

  const hasUnread = items.some(
    (it) => it.kind === 'overdue' || !it.read || (it.unread_count ?? 0) > 0,
  )

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#f5f7f9] transition-colors"
        aria-label="Notificaciones"
      >
        <span className="material-symbols-outlined text-[22px] text-[#2c2f31]">notifications</span>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-[#b31b25] text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-[360px] max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-xl ring-1 ring-black/10 overflow-hidden flex flex-col max-h-[80vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#dfe3e6]">
              <div className="text-sm font-bold text-[#2c2f31]">Notificaciones</div>
              {hasUnread && (
                <button
                  type="button"
                  onClick={handleMarkAll}
                  className="text-[11px] font-semibold text-[#00675c] hover:underline"
                >
                  Marcar todo leído
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {items.length === 0 ? (
                <div className="py-10 text-center text-sm text-[#595c5e]/70">
                  No tienes notificaciones pendientes.
                </div>
              ) : (
                items.map((item) => (
                  <NotificationRow
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    onClick={() => handleItemClick(item)}
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function NotificationRow({ item, onClick }: { item: NotificationItem; onClick: () => void }) {
  const timeAgo = (() => {
    try {
      return formatDistanceToNow(parseISO(item.created_at), { locale: es, addSuffix: false })
    } catch {
      return ''
    }
  })()

  const isOverdue = item.kind === 'overdue'
  const isMention = item.kind === 'mention'

  if (isOverdue) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-[#b31b25]/10 transition-colors border-b border-[#dfe3e6]/60 last:border-b-0 bg-[#b31b25]/5 border-l-4 border-l-[#b31b25]"
      >
        <span className="w-8 h-8 rounded-full bg-[#b31b25]/10 flex items-center justify-center flex-shrink-0">
          <span className="material-symbols-outlined text-[18px] text-[#b31b25]">warning</span>
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs leading-tight">
              <span className="font-bold text-[#b31b25] uppercase tracking-wide text-[10px]">Vencido</span>
              {item.overdue_days != null && item.overdue_days > 0 && (
                <span className="ml-1 text-[10px] text-[#b31b25]/80">
                  hace {item.overdue_days}d
                </span>
              )}
              <div className="font-semibold text-[#2c2f31] mt-0.5 truncate">
                {item.overdue_requirement_title}
              </div>
              {item.overdue_client_name && (
                <div className="text-[#595c5e]/70 text-[11px]">{item.overdue_client_name}</div>
              )}
            </div>
          </div>
        </div>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-[#f5f7f9] transition-colors border-b border-[#dfe3e6]/60 last:border-b-0 ' +
        (isMention && !item.read ? 'bg-[#00675c]/5 border-l-2 border-l-[#00675c]' : '')
      }
    >
      {isMention ? (
        <UserAvatar
          name={item.mentioned_by?.full_name ?? '?'}
          avatarUrl={item.mentioned_by?.avatar_url ?? null}
          size="sm"
        />
      ) : item.conversation_type === 'channel' ? (
        <span className="w-8 h-8 rounded-full bg-[#00675c]/10 flex items-center justify-center text-[#00675c] font-bold flex-shrink-0">
          #
        </span>
      ) : (
        <UserAvatar
          name={item.counterpart?.full_name ?? '?'}
          avatarUrl={item.counterpart?.avatar_url ?? null}
          size="sm"
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-[#595c5e] leading-tight">
            {isMention ? (
              <>
                <span className="font-semibold text-[#00675c]">
                  @{item.mentioned_by?.full_name ?? 'Alguien'}
                </span>{' '}
                te mencionó en{' '}
                <span className="font-semibold text-[#2c2f31]">
                  {item.requirement_title ?? 'un requerimiento'}
                </span>
              </>
            ) : item.conversation_type === 'channel' ? (
              <span className="font-semibold text-[#2c2f31]">
                #{item.conversation_name ?? 'canal'}
              </span>
            ) : (
              <span className="font-semibold text-[#2c2f31]">
                {item.counterpart?.full_name ?? 'Mensaje directo'}
              </span>
            )}
          </div>
          <span className="text-[10px] text-[#595c5e]/60 flex-shrink-0 whitespace-nowrap">
            {timeAgo}
          </span>
        </div>

        {(item.message_preview || item.last_message_preview) && (
          <div className="text-xs text-[#2c2f31] mt-1 line-clamp-2">
            {item.message_preview ?? item.last_message_preview}
          </div>
        )}

        {!isMention && (item.unread_count ?? 0) > 0 && (
          <div className="mt-1">
            <span className="inline-flex items-center min-w-[18px] h-[18px] px-1.5 bg-[#b31b25] text-white text-[10px] font-bold rounded-full">
              {(item.unread_count ?? 0) > 99 ? '99+' : item.unread_count}
            </span>
          </div>
        )}
      </div>
    </button>
  )
}
