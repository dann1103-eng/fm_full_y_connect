'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { SidebarContent } from '@/components/layout/Sidebar'
import { useMobileSidebar } from '@/components/layout/MobileSidebarProvider'

interface MobileSidebarProps {
  renewalCount?: number
  agencyLogoUrl?: string | null
}

export function MobileSidebar({ renewalCount, agencyLogoUrl }: MobileSidebarProps) {
  const { open, setOpen } = useMobileSidebar()
  const pathname = usePathname()

  useEffect(() => {
    setOpen(false)
  }, [pathname, setOpen])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <div
      className={`fixed inset-0 z-50 md:hidden ${open ? '' : 'pointer-events-none'}`}
      aria-hidden={!open}
    >
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={() => setOpen(false)}
      />
      <aside
        className={`absolute inset-y-0 left-0 w-72 max-w-[85%] bg-fm-surface-container-lowest shadow-xl border-r border-fm-outline-variant/30 transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <SidebarContent
          renewalCount={renewalCount}
          agencyLogoUrl={agencyLogoUrl}
          onNavigate={() => setOpen(false)}
        />
      </aside>
    </div>
  )
}
