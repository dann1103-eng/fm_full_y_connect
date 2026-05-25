'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUserOrNull } from '@/contexts/UserContext'
import type { ActiveCallInfo } from '@/types/db'

interface ActiveCallContextValue {
  activeCall: ActiveCallInfo | null
  minimized: boolean
  fullscreen: boolean
  startActiveCall: (info: ActiveCallInfo) => void
  endActiveCall: () => void
  setMinimized: (m: boolean) => void
  setFullscreen: (f: boolean) => void
}

const ActiveCallContext = createContext<ActiveCallContextValue | null>(null)

export function ActiveCallProvider({ children }: { children: ReactNode }) {
  const user = useUserOrNull()
  const [activeCall, setActiveCall] = useState<ActiveCallInfo | null>(null)
  const [minimized, setMinimized] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  const startActiveCall = useCallback((info: ActiveCallInfo) => {
    setActiveCall(info)
    setMinimized(false)
    setFullscreen(false)
  }, [])

  const endActiveCall = useCallback(() => {
    setActiveCall(null)
    setMinimized(false)
    setFullscreen(false)
  }, [])

  // Cuando el otro lado cuelga (o el ringtone expira sin respuesta), la sesión
  // queda con `ended_at` en la DB. Realtime nos avisa y aquí terminamos la
  // active call local automáticamente — sin que el usuario quede colgado en
  // un room vacío.
  useEffect(() => {
    if (!activeCall) return
    const supabase = createClient()
    const channel = supabase.channel(`active-call-watch-${activeCall.sessionId}`)
    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'call_sessions',
        filter: `id=eq.${activeCall.sessionId}`,
      },
      (payload) => {
        const row = payload.new as { ended_at?: string | null }
        if (row.ended_at) {
          endActiveCall()
        }
      }
    )
    channel.subscribe()
    return () => {
      channel.unsubscribe()
    }
  }, [activeCall, endActiveCall])

  // Segunda vía: el caller hace broadcast a `user:{id}` con `call_ended` cuando
  // cuelga en un DM. Garantiza que el receptor se desconecte aunque el
  // postgres_changes UPDATE de call_sessions tarde en llegar.
  useEffect(() => {
    if (!user?.id) return
    const supabase = createClient()
    const ch = supabase.channel(`user:${user.id}`)
    ch.on('broadcast', { event: 'call_ended' }, ({ payload }) => {
      const sessionId = (payload as { sessionId?: string } | null)?.sessionId
      if (sessionId && activeCall?.sessionId === sessionId) {
        endActiveCall()
      }
    })
    ch.subscribe()
    return () => {
      ch.unsubscribe()
    }
  }, [user?.id, activeCall?.sessionId, endActiveCall])

  const value = useMemo<ActiveCallContextValue>(
    () => ({
      activeCall,
      minimized,
      fullscreen,
      startActiveCall,
      endActiveCall,
      setMinimized,
      setFullscreen,
    }),
    [activeCall, minimized, fullscreen, startActiveCall, endActiveCall]
  )

  return <ActiveCallContext.Provider value={value}>{children}</ActiveCallContext.Provider>
}

export function useActiveCall(): ActiveCallContextValue {
  const ctx = useContext(ActiveCallContext)
  if (!ctx) throw new Error('useActiveCall debe usarse dentro de <ActiveCallProvider>')
  return ctx
}

export function useActiveCallOrNull(): ActiveCallContextValue | null {
  return useContext(ActiveCallContext)
}
