'use client'

import Link from 'next/link'
import { useUser } from '@/contexts/UserContext'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { useMobileSidebar } from '@/components/layout/MobileSidebarProvider'
import { NotificationsDropdown } from '@/components/layout/NotificationsDropdown'

interface TopNavProps {
  title: string
}

export function TopNav({ title }: TopNavProps) {
  const user = useUser()
  const { setOpen } = useMobileSidebar()
  const displayName = user.full_name || user.email

  return (
    <header className="h-16 flex items-center justify-between gap-3 px-4 sm:px-6 bg-white border-b border-[#abadaf]/30 flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="md:hidden -ml-2 p-2 rounded-lg text-[#595c5e] hover:bg-[#f5f7f9]"
          aria-label="Abrir menú"
        >
          <span className="material-symbols-outlined text-[22px]">menu</span>
        </button>
        <h1 className="text-lg font-semibold text-[#2c2f31] truncate">{title}</h1>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <NotificationsDropdown />
        <Link
          href="/profile"
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-[#2c2f31] leading-tight">{displayName}</p>
            <p className="text-xs text-[#595c5e] capitalize">{user.role}</p>
          </div>
          <UserAvatar name={displayName} avatarUrl={user.avatar_url} size="sm" />
        </Link>
      </div>
    </header>
  )
}
