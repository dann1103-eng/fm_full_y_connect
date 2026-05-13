'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

interface Props {
  sidebar: ReactNode
  children: ReactNode
}

/**
 * Shell responsivo del inbox de WhatsApp.
 *  - Mobile: muestra la lista en /whatsapp y el chat cuando hay /whatsapp/[id].
 *  - Desktop: ambos lado a lado siempre.
 */
export function WaResponsiveShell({ sidebar, children }: Props) {
  const pathname = usePathname()
  const isList = pathname === '/whatsapp'

  return (
    <div className="flex h-full overflow-hidden">
      <div className={isList ? 'flex w-full sm:w-auto' : 'hidden sm:flex'}>
        {sidebar}
      </div>
      <div className={isList ? 'hidden sm:flex flex-1 overflow-hidden' : 'flex flex-1 overflow-hidden w-full'}>
        {children}
      </div>
    </div>
  )
}
