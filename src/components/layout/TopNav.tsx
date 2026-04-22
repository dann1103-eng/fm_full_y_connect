'use client'

import Link from 'next/link'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { useUser } from '@/contexts/UserContext'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { useMobileSidebar } from '@/components/layout/MobileSidebarProvider'
import { NotificationsDropdown } from '@/components/layout/NotificationsDropdown'

interface TopNavProps {
  title: string
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

export function TopNav({ title }: TopNavProps) {
  const user = useUser()
  const { setOpen } = useMobileSidebar()
  const displayName = user.full_name || user.email

  return (
    <header className="h-16 flex items-center justify-between gap-3 px-4 sm:px-6 bg-fm-surface-container-lowest border-b border-fm-outline-variant/30 flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="md:hidden -ml-2 p-2 rounded-lg text-fm-on-surface-variant hover:bg-fm-surface-container-low"
          aria-label="Abrir menú"
        >
          <span className="material-symbols-outlined text-[22px]">menu</span>
        </button>
        <h1 className="text-lg font-semibold text-fm-on-surface truncate">{title}</h1>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <ThemeToggle />
        <NotificationsDropdown />
        <Link
          href="/profile"
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-fm-on-surface leading-tight">{displayName}</p>
            <p className="text-xs text-fm-on-surface-variant capitalize">{user.role}</p>
          </div>
          <UserAvatar name={displayName} avatarUrl={user.avatar_url} size="sm" />
        </Link>
      </div>
    </header>
  )
}
