'use client'

import { createContext, useContext, useState } from 'react'

interface MobileSidebarContextValue {
  open: boolean
  setOpen: (v: boolean) => void
}

const Ctx = createContext<MobileSidebarContextValue | null>(null)

export function MobileSidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>
}

export function useMobileSidebar(): MobileSidebarContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) {
    // Fall back to a no-op so server components or isolated trees don't crash.
    return { open: false, setOpen: () => {} }
  }
  return ctx
}
