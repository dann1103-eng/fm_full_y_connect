'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { ActiveClientSwitcher } from './ActiveClientSwitcher'

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
}

const navItems: NavItem[] = [
  {
    href: '/portal/dashboard',
    label: 'Dashboard',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/>
      </svg>
    ),
  },
  {
    href: '/portal/pipeline',
    label: 'Pipeline',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/>
      </svg>
    ),
  },
  {
    href: '/portal/calendario',
    label: 'Calendario',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V8h16v13zm-7-7h5v5h-5z"/>
      </svg>
    ),
  },
  {
    href: '/portal/facturacion',
    label: 'Facturación',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
      </svg>
    ),
  },
  {
    href: '/portal/empresa',
    label: 'Mi empresa',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/>
      </svg>
    ),
  },
  {
    href: '/portal/config',
    label: 'Configuración',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94 0 .31.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
      </svg>
    ),
  },
]

interface PortalSidebarProps {
  clientOptions: Array<{ id: string; name: string; logo_url: string | null }>
  activeClientId: string
  clientDisplayName: string
}

export function PortalSidebar({
  clientOptions,
  activeClientId,
  clientDisplayName,
}: PortalSidebarProps) {
  const pathname = usePathname()
  const [logoError, setLogoError] = useState(false)

  const active = clientOptions.find((c) => c.id === activeClientId)
  const logoUrl = active?.logo_url ?? null
  const initial = clientDisplayName.charAt(0).toUpperCase()

  const switcherOptions = clientOptions.map((c) => ({ id: c.id, name: c.name }))

  return (
    <aside className="fixed inset-y-0 left-0 z-40 w-64 hidden md:flex flex-col bg-fm-surface-container-lowest border-r border-fm-outline-variant/30 shadow-sm">
      <div className="flex h-full flex-col">
        {/* Logo / marca activa */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-fm-outline-variant/20">
          <div
            className={cn(
              'w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center',
              logoUrl && !logoError ? 'bg-white border border-fm-outline-variant/30' : 'signature-gradient'
            )}
          >
            {logoUrl && !logoError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={clientDisplayName}
                className="w-full h-full object-contain p-0.5"
                onError={() => setLogoError(true)}
              />
            ) : (
              <span className="text-white font-bold text-sm">{initial}</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-fm-on-surface text-sm leading-tight truncate">
              {clientDisplayName}
            </p>
            <p className="text-fm-on-surface-variant text-xs">Portal cliente</p>
          </div>
        </div>

        {/* Selector de marca (si hay más de una) */}
        {clientOptions.length > 1 && (
          <div className="px-3 py-3 border-b border-fm-outline-variant/20">
            <ActiveClientSwitcher options={switcherOptions} activeId={activeClientId} />
          </div>
        )}

        {/* Navegación */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive =
              item.href === '/portal/dashboard'
                ? pathname === '/portal/dashboard'
                : pathname.startsWith(item.href)

            return (
              <Link
                key={item.href}
                href={item.href}
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
              </Link>
            )
          })}
        </nav>

        {/* Cerrar sesión */}
        <div className="px-3 pb-4 border-t border-fm-outline-variant/20 pt-3">
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
    </aside>
  )
}
