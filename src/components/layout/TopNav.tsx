'use client'

import Link from 'next/link'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { useUser } from '@/contexts/UserContext'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { useMobileSidebar } from '@/components/layout/MobileSidebarProvider'
import { NotificationsDropdown } from '@/components/layout/NotificationsDropdown'
import { ShiftStatusWidget } from '@/components/layout/ShiftStatusWidget'
import { PresenceSelector } from '@/components/presence/PresenceSelector'
import { useUsersPresence } from '@/hooks/useUsersPresence'
import { useDevRequestsBadge } from '@/hooks/useDevRequestsBadge'

interface TopNavProps {
  title: string
  backHref?: string
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    Promise.resolve().then(() => setMounted(true))
  }, [])

  const isDark = mounted && resolvedTheme === 'dark'
  const toggle = () => setTheme(isDark ? 'light' : 'dark')

  return (
    <button
      type="button"
      onClick={toggle}
      className="p-2 rounded-lg text-fm-on-surface-variant hover:bg-fm-surface-container-low"
      aria-label={isDark ? 'Activar modo claro' : 'Activar modo oscuro'}
      suppressHydrationWarning
    >
      <span className="material-symbols-outlined text-[22px]" suppressHydrationWarning>
        {mounted ? (isDark ? 'light_mode' : 'dark_mode') : 'dark_mode'}
      </span>
    </button>
  )
}

export function TopNav({ title, backHref }: TopNavProps) {
  const user = useUser()
  const { setOpen } = useMobileSidebar()
  const { getStatusMessage } = useUsersPresence()
  const devBadge = useDevRequestsBadge()
  const displayName = user.full_name || user.email
  const statusMessage = getStatusMessage(user.id)
  const statusLine = statusMessage && (statusMessage.emoji || statusMessage.message)
    ? `${statusMessage.emoji ?? ''}${statusMessage.emoji && statusMessage.message ? ' ' : ''}${statusMessage.message ?? ''}`
    : null

  return (
    <header className="sticky top-0 z-30 h-16 flex items-center justify-between gap-3 px-4 sm:px-6 bg-fm-surface-container-lowest border-b border-fm-outline-variant/30 flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="md:hidden -ml-2 p-2 rounded-lg text-fm-on-surface-variant hover:bg-fm-surface-container-low"
          aria-label="Abrir menú"
        >
          <span className="material-symbols-outlined text-[22px]">menu</span>
        </button>
        {backHref && (
          <Link
            href={backHref}
            className="-ml-1 p-1.5 rounded-lg text-fm-on-surface-variant hover:bg-fm-surface-container-low transition-colors"
            aria-label="Volver"
          >
            <span className="material-symbols-outlined text-[22px]">arrow_back</span>
          </Link>
        )}
        <h1 className="text-lg font-semibold text-fm-on-surface truncate">{title}</h1>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <PresenceSelector />
        <ShiftStatusWidget />
        <ThemeToggle />
        <NotificationsDropdown />
        {user.can_request_dev && user.role === 'admin' && (
          <Link
            href="/solicitudes-dev"
            className="relative p-2 rounded-lg text-fm-on-surface-variant hover:bg-fm-surface-container-low transition-colors"
            title="Solicitudes especiales"
          >
            <span className="text-[20px] leading-none">💌</span>
            {devBadge > 0 && (
              <span className="absolute top-0.5 right-0.5 bg-fm-error text-white font-bold leading-none min-w-[16px] h-[16px] rounded-full flex items-center justify-center px-[3px] text-[9px]">
                {devBadge > 9 ? '9+' : devBadge}
              </span>
            )}
          </Link>
        )}
        <Link
          href="/profile"
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <div className="text-right hidden sm:block max-w-[180px]">
            <p className="text-sm font-medium text-fm-on-surface leading-tight truncate">{displayName}</p>
            <p className="text-xs text-fm-on-surface-variant capitalize leading-tight">{user.role}</p>
            {statusLine && (
              <p className="text-[10px] text-fm-outline-variant leading-tight truncate" title={statusLine}>
                {statusLine}
              </p>
            )}
          </div>
          <UserAvatar name={displayName} avatarUrl={user.avatar_url} size="sm" />
        </Link>
      </div>
    </header>
  )
}
