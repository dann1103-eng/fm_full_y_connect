'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { NewMessageDialog } from './NewMessageDialog'
import { useInboxList } from '@/hooks/useInboxPolling'
import { useUser } from '@/contexts/UserContext'
import { useUsersPresence } from '@/hooks/useUsersPresence'
import { PresenceIndicator } from '@/components/presence/PresenceIndicator'
import { createOrGetDM } from '@/app/actions/inbox'
import type { ConversationListItem, AppUser, EffectivePresenceStatus } from '@/types/db'

interface InboxSidebarProps {
  initialList: ConversationListItem[]
  allUsers: Pick<AppUser, 'id' | 'full_name' | 'avatar_url' | 'role'>[]
}

export function InboxSidebar({ initialList, allUsers }: InboxSidebarProps) {
  const pathname = usePathname()
  const user = useUser()
  const { data } = useInboxList(initialList)
  const { getEffective, getStatusMessage, isConvInCall } = useUsersPresence()
  const [dialogOpen, setDialogOpen] = useState(false)

  const canCreateChannels = user.role === 'admin' || user.role === 'supervisor'

  const { channels, totalUnread } = useMemo(() => {
    const channels = data.filter((c) => c.type === 'channel')
    const totalUnread = data.reduce((sum, c) => sum + c.unread_count, 0)
    return { channels, totalUnread }
  }, [data])

  // Mapa de user_id → conversación DM existente (para unread counts y navegación directa)
  const dmByUserId = useMemo(() => {
    const map = new Map<string, ConversationListItem>()
    for (const c of data) {
      if (c.type === 'dm' && c.counterpart) {
        map.set(c.counterpart.id, c)
      }
    }
    return map
  }, [data])

  // Orden estilo WhatsApp:
  //   1. Miembros con mensajes no leídos (más recientes primero).
  //   2. Miembros con DM existente sin no leídos (por último mensaje).
  //   3. Resto del equipo, alfabético.
  const teamMembers = useMemo(() => {
    const others = allUsers.filter((u) => u.id !== user.id)
    return others.slice().sort((a, b) => {
      const dmA = dmByUserId.get(a.id)
      const dmB = dmByUserId.get(b.id)
      const unreadA = dmA?.unread_count ?? 0
      const unreadB = dmB?.unread_count ?? 0

      // Tier 1: con no leídos > sin no leídos
      const tierA = unreadA > 0 ? 0 : dmA ? 1 : 2
      const tierB = unreadB > 0 ? 0 : dmB ? 1 : 2
      if (tierA !== tierB) return tierA - tierB

      // Dentro del tier 0 y 1: por last_message_at desc
      if (tierA < 2) {
        const tA = dmA?.last_message_at ? Date.parse(dmA.last_message_at) : 0
        const tB = dmB?.last_message_at ? Date.parse(dmB.last_message_at) : 0
        if (tA !== tB) return tB - tA
      }

      // Tier 2: alfabético por nombre
      return (a.full_name ?? '').localeCompare(b.full_name ?? '', 'es', { sensitivity: 'base' })
    })
  }, [allUsers, user.id, dmByUserId])

  const activeId = pathname.startsWith('/inbox/') ? pathname.split('/')[2] : null

  return (
    <aside className="flex flex-col h-full w-full sm:w-72 bg-fm-surface-container-lowest border-r border-fm-surface-container-high flex-shrink-0">
      <div className="px-5 py-4 border-b border-fm-surface-container-high">
        <div className="text-lg font-extrabold text-fm-primary">Equipo</div>
        <div className="text-xs text-fm-on-surface-variant mt-0.5">Chat interno del equipo</div>
        {totalUnread > 0 && (
          <div className="mt-2 text-xs font-semibold text-fm-error">
            {totalUnread} mensaje{totalUnread !== 1 ? 's' : ''} nuevo{totalUnread !== 1 ? 's' : ''}
          </div>
        )}
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
              <ConvLink
                key={c.id}
                conv={c}
                active={activeId === c.id}
                inCall={isConvInCall(c.id)}
              />
            ))}
          </div>
        </section>

        <section className="mt-6">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="text-[10px] font-bold text-fm-on-surface-variant uppercase tracking-widest">
              Miembros del equipo
            </div>
          </div>
          <div className="space-y-0.5">
            {teamMembers.length === 0 && (
              <div className="px-3 py-2 text-xs text-fm-on-surface-variant/70 italic">Sin miembros</div>
            )}
            {teamMembers.map((u) => {
              const dm = dmByUserId.get(u.id)
              const dmActive = dm ? activeId === dm.id : false
              return (
                <TeamMemberRow
                  key={u.id}
                  member={u}
                  dm={dm}
                  active={dmActive}
                  status={getEffective(u.id)}
                  statusMessage={getStatusMessage(u.id)}
                />
              )
            })}
          </div>
        </section>
      </nav>

      <NewMessageDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        canCreateChannels={canCreateChannels}
        allUsers={teamMembers}
      />
    </aside>
  )
}

function TeamMemberRow({
  member,
  dm,
  active,
  status,
  statusMessage,
}: {
  member: Pick<AppUser, 'id' | 'full_name' | 'avatar_url'>
  dm: ConversationListItem | undefined
  active: boolean
  status: EffectivePresenceStatus
  statusMessage: { emoji: string | null; message: string | null } | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleClick() {
    if (dm) {
      router.push(`/inbox/${dm.id}`)
      return
    }
    startTransition(async () => {
      const res = await createOrGetDM(member.id)
      if ('conversationId' in res && res.conversationId) {
        router.push(`/inbox/${res.conversationId}`)
      }
    })
  }

  const hasStatusMsg = !!(statusMessage && (statusMessage.emoji || statusMessage.message))
  const statusLine = hasStatusMsg
    ? `${statusMessage!.emoji ?? ''}${statusMessage!.emoji && statusMessage!.message ? ' ' : ''}${statusMessage!.message ?? ''}`
    : ''

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className={cn(
        'w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors',
        active
          ? 'bg-fm-primary/10 text-fm-primary font-semibold'
          : 'text-fm-on-surface-variant hover:bg-fm-background',
        pending && 'opacity-60'
      )}
    >
      <span className="flex items-center min-w-0 flex-1 gap-2">
        <span className="relative flex-shrink-0">
          <UserAvatar
            name={member.full_name ?? '?'}
            avatarUrl={member.avatar_url}
            size="xs"
          />
          <PresenceIndicator status={status} overlay size="xs" />
        </span>
        <span className="flex flex-col min-w-0 flex-1">
          <span className="truncate leading-tight">{member.full_name}</span>
          {hasStatusMsg && (
            <span
              className="truncate text-[10px] font-normal text-fm-outline-variant leading-tight"
              title={statusLine}
            >
              {statusLine}
            </span>
          )}
        </span>
      </span>
      {dm && dm.unread_count > 0 && (
        <span className="ml-2 flex-shrink-0 bg-fm-error text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center">
          {dm.unread_count > 99 ? '99+' : dm.unread_count}
        </span>
      )}
    </button>
  )
}

function ConvLink({
  conv,
  active,
  inCall,
}: {
  conv: ConversationListItem
  active: boolean
  inCall?: boolean
}) {
  const label = conv.name ?? 'canal'

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
        <span className={cn('mr-2 font-bold', active ? 'text-fm-primary' : 'text-fm-primary/80')}>#</span>
        <span className="truncate">{label}</span>
        {inCall && (
          <span
            className="ml-1.5 flex-shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-600 text-[9px] font-bold uppercase tracking-wide"
            title="Llamada activa en este canal"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            En llamada
          </span>
        )}
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
