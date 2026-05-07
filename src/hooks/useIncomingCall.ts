'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { IncomingCallPayload } from '@/types/db'

/**
 * Suscribe el canal broadcast `user:{userId}` para recibir `incoming_call`.
 * Devuelve la última invitación recibida (o null si fue rechazada/aceptada).
 */
export function useIncomingCall(userId: string | null) {
  const [incoming, setIncoming] = useState<IncomingCallPayload | null>(null)

  useEffect(() => {
    if (!userId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`user:${userId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'incoming_call' }, (msg) => {
        const payload = msg.payload as IncomingCallPayload
        setIncoming(payload)
      })
      .on('broadcast', { event: 'call_canceled' }, (msg) => {
        const sessionId = (msg.payload as { sessionId?: string }).sessionId
        setIncoming((prev) => (prev && prev.sessionId === sessionId ? null : prev))
      })
      .subscribe((status, err) => {
        console.info(`[useIncomingCall ${userId}] status:`, status, err ?? '')
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  return {
    incoming,
    dismiss: () => setIncoming(null),
  }
}
