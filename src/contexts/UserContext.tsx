'use client'

import { createContext, useContext } from 'react'
import type { AppUser } from '@/types/db'

const UserContext = createContext<AppUser | null>(null)

export function UserProvider({
  user,
  children,
}: {
  user: AppUser
  children: React.ReactNode
}) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>
}

export function useUser(): AppUser {
  const ctx = useContext(UserContext)
  if (!ctx) throw new Error('useUser must be used inside UserProvider')
  return ctx
}
