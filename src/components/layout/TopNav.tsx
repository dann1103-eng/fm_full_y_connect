'use client'

import Link from 'next/link'
import { useUser } from '@/contexts/UserContext'
import { UserAvatar } from '@/components/ui/UserAvatar'

interface TopNavProps {
  title: string
}

export function TopNav({ title }: TopNavProps) {
  const user = useUser()
  const displayName = user.full_name || user.email

  return (
    <header className="h-16 flex items-center justify-between px-6 bg-white border-b border-[#abadaf]/30 flex-shrink-0">
      <h1 className="text-lg font-semibold text-[#2c2f31]">{title}</h1>

      <Link href="/profile" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
        <div className="text-right">
          <p className="text-sm font-medium text-[#2c2f31] leading-tight">{displayName}</p>
          <p className="text-xs text-[#595c5e] capitalize">{user.role}</p>
        </div>
        <UserAvatar name={displayName} avatarUrl={user.avatar_url} size="sm" />
      </Link>
    </header>
  )
}
