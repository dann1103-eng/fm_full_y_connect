'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useMemo, useState } from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { NewMessageDialog } from './NewMessageDialog'
import { useInboxList } from '@/hooks/useInboxPolling'
import { useUser } from '@/contexts/UserContext'
import type { ConversationListItem, AppUser } from '@/types/db'

interface InboxSidebarProps {
  initialList: ConversationListItem[]
  allUsers: Pick<AppUser, 'id' | 'full_name' | 'avatar_url' | 'role'>[]
}

export function InboxSidebar({ initialList, allUsers }: InboxSidebarProps) {
  const pathname = usePathname()
  const user = useUser()
  const { data } = useInboxList(initialList)
  const [dialogOpen, setDialogOpen] = useState(false)

  const canCreateChannels = user.role === 'admin' || user.role === 'supervisor'

  const { channels, dms } = useMemo(() => {
    const channels = data.filter((c) => c.type === 'channel')
    const dms = data.filter((c) => c.type === 'dm')
    return { channels, dms }
  }, [data])

  const activeId = pathname.startsWith('/inbox/') ? pathname.split('/')[2] : null

  return (
    <aside className="flex flex-col h-full w-full sm:w-72 bg-fm-surface-container-lowest border-r border-fm-surface-container-high flex-shrink-0">
      <div className="px-5 py-4 border-b border-fm-surface-container-high">
        <div className="text-lg font-extrabold text-fm-primary">Bandeja</div>
        <div className="text-xs text-fm-on-surface-variant mt-0.5">Chat interno del equipo</div>
      </div>

      <div className="p-4">
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="w-full flex items-center justify-center space-x-2 bg-fm-primary text-white py-2.5 px-4 rounded-lg font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
          </svg>
          <span>Nuevo mensaje</span>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <section className="mt-2">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="text-[10px] font-bold text-fm-on-surface-variant uppercase tracking-widest">Canales</div>
          </div>
          <div className="space-y-0.5">
            {channels.length === 0 && (
              <div className="px-3 py-2 text-xs text-fm-on-surface-variant/70 italic">Sin canales</div>
            )}
            {channels.map((c) => (
              <ConvLink key={c.id} conv={c} active={activeId === c.id} />
            ))}
          </div>
        </section>

        <section className="mt-6">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="text-[10px] font-bold text-fm-on-surface-variant uppercase tracking-widest">
              Mensajes directos
            </div>
          </div>
          <div className="space-y-0.5">
            {dms.length === 0 && (
              <div className="px-3 py-2 text-xs text-fm-on-surface-variant/70 italic">Sin mensajes directos</div>
            )}
            {dms.map((c) => (
              <ConvLink key={c.id} conv={c} active={activeId === c.id} />
            ))}
          </div>
        </section>
      </nav>

      <NewMessageDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        canCreateChannels={canCreateChannels}
        allUsers={allUsers.filter((u) => u.id !== user.id)}
      />
    </aside>
  )
}

function ConvLink({ conv, active }: { conv: ConversationListItem; active: boolean }) {
  const label =
    conv.type === 'channel'
      ? conv.name ?? 'canal'
      : conv.counterpart?.full_name ?? 'Usuario'

  const timeAgo = useMemo(() => {
    try {
      return formatDistanceToNow(parseISO(conv.last_message_at), { locale: es, addSuffix: false })
    } catch {
      return ''
    }
  }, [conv.last_message_at])

  return (
    <Link
      href={`/inbox/${conv.id}`}
      className={cn(
        'flex items-center justify-between px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors',
        active
          ? 'bg-fm-primary/10 text-fm-primary font-semibold'
          : 'text-fm-on-surface-variant hover:bg-fm-background'
      )}
    >
      <span className="flex items-center min-w-0 flex-1">
        {conv.type === 'channel' ? (
          <span className={cn('mr-2 font-bold', active ? 'text-fm-primary' : 'text-fm-primary/80')}>#</span>
        ) : (
          <span className="mr-2 flex-shrink-0">
            <UserAvatar
              name={conv.counterpart?.full_name ?? '?'}
              avatarUrl={conv.counterpart?.avatar_url}
              size="xs"
            />
          </span>
        )}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex items-center gap-2 flex-shrink-0 ml-2">
        {conv.unread_count > 0 ? (
          <span className="bg-fm-error text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
            {conv.unread_count > 99 ? '99+' : conv.unread_count}
          </span>
        ) : (
          <span className="text-[10px] text-fm-on-surface-variant/60">{timeAgo}</span>
        )}
      </span>
    </Link>
  )
}
