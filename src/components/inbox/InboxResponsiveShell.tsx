'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

interface InboxResponsiveShellProps {
  sidebar: ReactNode
  children: ReactNode
}

export function InboxResponsiveShell({ sidebar, children }: InboxResponsiveShellProps) {
  const pathname = usePathname()
  const isListView = pathname === '/inbox'

  return (
    <div className="flex h-full overflow-hidden">
      <div className={isListView ? 'flex sm:flex w-full sm:w-auto' : 'hidden sm:flex'}>
        {sidebar}
      </div>
      <div
        className={
          isListView
            ? 'hidden sm:flex flex-1 overflow-hidden'
            : 'flex flex-1 overflow-hidden w-full'
        }
      >
        {children}
      </div>
    </div>
  )
}
