'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { useUser } from '@/contexts/UserContext'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { useInboxList } from '@/hooks/useInboxPolling'
import type { UserRole } from '@/types/db'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  badge?: boolean
  badgeKey?: 'inbox'
  allowedRoles?: UserRole[]
}

const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/>
      </svg>
    ),
  },
  {
    href: '/inbox',
    label: 'Inbox',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM9 11H7V9h2v2zm4 0h-2V9h2v2zm4 0h-2V9h2v2z"/>
      </svg>
    ),
    badgeKey: 'inbox',
  },
  {
    href: '/clients',
    label: 'Clientes',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
      </svg>
    ),
  },
  {
    href: '/pipeline',
    label: 'Pipeline',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/>
      </svg>
    ),
  },
  {
    href: '/reports',
    label: 'Reportes',
    allowedRoles: ['admin', 'supervisor'],
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H7v-2h5v2zm3-4H7v-2h8v2zm0-4H7V7h8v2z"/>
      </svg>
    ),
  },
  {
    href: '/renewals',
    label: 'Renovaciones',
    allowedRoles: ['admin'],
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
      </svg>
    ),
    badge: true,
  },
  {
    href: '/tiempo',
    label: 'Tiempo',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>
      </svg>
    ),
  },
  {
    href: '/plans',
    label: 'Planes',
    allowedRoles: ['admin', 'supervisor'],
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/>
      </svg>
    ),
  },
  {
    href: '/users',
    label: 'Usuarios',
    allowedRoles: ['admin'],
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
      </svg>
    ),
  },
]

interface SidebarProps {
  renewalCount?: number
  agencyLogoUrl?: string | null
}

export function SidebarContent({
  renewalCount = 0,
  agencyLogoUrl,
  onNavigate,
}: SidebarProps & { onNavigate?: () => void }) {
  const pathname = usePathname()
  const user = useUser()
  const [logoError, setLogoError] = useState(false)
  const { data: inboxList } = useInboxList()
  const inboxUnread = inboxList.reduce((sum, c) => sum + c.unread_count, 0)

  const visibleItems = navItems.filter(
    (item) => !item.allowedRoles || item.allowedRoles.includes(user.role)
  )

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-fm-outline-variant/20">
        <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 signature-gradient flex items-center justify-center">
          {agencyLogoUrl && !logoError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={agencyLogoUrl}
              alt="FM"
              className="w-full h-full object-cover"
              onError={() => setLogoError(true)}
            />
          ) : (
            <span className="text-white font-bold text-sm">FM</span>
          )}
        </div>
        <div>
          <p className="font-bold text-fm-on-surface text-sm leading-tight">FM Communication</p>
          <p className="text-fm-on-surface-variant text-xs">Solutions</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item) => {
          const isActive =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
                isActive
                  ? 'bg-fm-primary/10 text-fm-primary'
                  : 'text-fm-on-surface-variant hover:bg-fm-background hover:text-fm-on-surface'
              )}
            >
              <span className={isActive ? 'text-fm-primary' : 'text-fm-outline'}>
                {item.icon}
              </span>
              <span>{item.label}</span>
              {item.badge && renewalCount > 0 && (
                <span className="ml-auto bg-fm-error text-white text-xs font-semibold px-2 py-0.5 rounded-full min-w-[20px] text-center">
                  {renewalCount}
                </span>
              )}
              {item.badgeKey === 'inbox' && inboxUnread > 0 && (
                <span className="ml-auto bg-fm-error text-white text-xs font-semibold px-2 py-0.5 rounded-full min-w-[20px] text-center">
                  {inboxUnread > 99 ? '99+' : inboxUnread}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Bottom section */}
      <div className="px-3 pb-4 border-t border-fm-outline-variant/20 pt-3 space-y-0.5">
        {/* User card → profile */}
        <Link
          href="/profile"
          onClick={onNavigate}
          className={cn(
            'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150',
            pathname === '/profile'
              ? 'bg-fm-primary/10'
              : 'hover:bg-fm-background'
          )}
        >
          <UserAvatar name={user.full_name} avatarUrl={user.avatar_url} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-fm-on-surface truncate">{user.full_name}</p>
            <p className="text-xs text-fm-outline-variant capitalize">{user.role}</p>
          </div>
        </Link>

        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-fm-on-surface-variant hover:bg-red-50 hover:text-fm-error transition-all duration-150"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/>
            </svg>
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  )
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 w-64 hidden md:flex flex-col bg-fm-surface-container-lowest border-r border-fm-outline-variant/30 shadow-sm">
      <SidebarContent {...props} />
    </aside>
  )
}
