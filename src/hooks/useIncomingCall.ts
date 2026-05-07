'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { IncomingCallPayload } from '@/types/db'
import type { RealtimeChannel } from '@supabase/supabase-js'

/**
 * Suscribe el canal broadcast `user:{userId}` para recibir `incoming_call`.
 * Devuelve la última invitación recibida (o null si fue rechazada/aceptada).
 *
 * Resiliencia: si el WebSocket se cae (CHANNEL_ERROR/TIMED_OUT/CLOSED), el
 * hook reintenta suscribirse con backoff (1s, 2s, 5s, ...). También re-conecta
 * cuando la pestaña vuelve a estar visible — en pestañas inactivas el browser
 * puede pausar el WS y nadie nos avisa.
 */
export function useIncomingCall(userId: string | null) {
  const [incoming, setIncoming] = useState<IncomingCallPayload | null>(null)

  useEffect(() => {
    if (!userId) return
    const supabase = createClient()
    let channel: RealtimeChannel | null = null
    let retryTimeout: ReturnType<typeof setTimeout> | null = null
    let attempt = 0
    let cancelled = false

    function scheduleReconnect() {
      if (cancelled) return
      if (retryTimeout) clearTimeout(retryTimeout)
      const delay = Math.min(1000 * Math.pow(2, attempt), 30_000)
      attempt += 1
      retryTimeout = setTimeout(() => {
        if (!cancelled) connect()
      }, delay)
    }

    function connect() {
      if (cancelled) return
      if (channel) {
        supabase.removeChannel(channel).catch(() => {})
        channel = null
      }
      channel = supabase
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
          if (status === 'SUBSCRIBED') {
            attempt = 0
            if (retryTimeout) {
              clearTimeout(retryTimeout)
              retryTimeout = null
            }
          } else if (
            status === 'CHANNEL_ERROR' ||
            status === 'TIMED_OUT' ||
            status === 'CLOSED'
          ) {
            scheduleReconnect()
          }
        })
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        // Cuando vuelve la pestaña al frente, forzamos reconexión: el WS
        // puede haber sido pausado por el browser sin emitir 'CLOSED'.
        attempt = 0
        connect()
      }
    }

    connect()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (retryTimeout) clearTimeout(retryTimeout)
      if (channel) supabase.removeChannel(channel).catch(() => {})
    }
  }, [userId])

  return {
    incoming,
    dismiss: () => setIncoming(null),
  }
}
