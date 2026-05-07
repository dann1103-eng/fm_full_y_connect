'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CallModality, IncomingCallPayload } from '@/types/db'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

const CATCH_UP_WINDOW_SECONDS = 60

/**
 * Suscribe el canal broadcast `user:{userId}` para recibir `incoming_call`.
 * Devuelve la última invitación recibida (o null si fue rechazada/aceptada).
 *
 * Resiliencia (necesario porque Supabase broadcast NO persiste — si no
 * estabas suscrito en el instante exacto del envío, el mensaje se pierde):
 *
 * 1. Reintento con backoff cuando el WS cae (CHANNEL_ERROR/TIMED_OUT/CLOSED).
 * 2. Reconexión proactiva al volver la pestaña a primer plano.
 * 3. Catch-up por DB en cada SUBSCRIBED: consulta call_sessions activas
 *    iniciadas en los últimos 60s donde el usuario es miembro de la
 *    conversación y aún no se ha unido. Esto recupera llamadas perdidas
 *    si el broadcast no llegó por race condition o WS dormido.
 */
export function useIncomingCall(userId: string | null) {
  const [incoming, setIncoming] = useState<IncomingCallPayload | null>(null)
  const dismissedRef = useRef<Set<string>>(new Set())

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
          if (dismissedRef.current.has(payload.sessionId)) return
          setIncoming(payload)
        })
        .on('broadcast', { event: 'call_canceled' }, (msg) => {
          const sessionId = (msg.payload as { sessionId?: string }).sessionId
          if (sessionId) dismissedRef.current.add(sessionId)
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
            // Catch-up: si me perdí un broadcast por race condition o WS
            // dormido, recupero la llamada vía DB.
            void runCatchUp(supabase, userId!, dismissedRef.current, setIncoming)
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
    dismiss: () => {
      setIncoming((prev) => {
        if (prev) dismissedRef.current.add(prev.sessionId)
        return null
      })
    },
  }
}

/**
 * Recupera llamadas entrantes activas que el usuario pudo haber perdido
 * por broadcast caído. RLS ya filtra a conversaciones donde es miembro.
 */
async function runCatchUp(
  supabase: SupabaseClient,
  userId: string,
  dismissed: Set<string>,
  setIncoming: (payload: IncomingCallPayload) => void,
): Promise<void> {
  try {
    const since = new Date(Date.now() - CATCH_UP_WINDOW_SECONDS * 1000).toISOString()
    const { data: sessions } = await supabase
      .from('call_sessions')
      .select(
        'id, conversation_id, livekit_room_name, modality, started_by, started_at, conversation:conversations(id, type, name), starter:users!started_by(id, full_name, avatar_url)',
      )
      .is('ended_at', null)
      .gte('started_at', since)
      .order('started_at', { ascending: false })

    if (!sessions || sessions.length === 0) return

    for (const s of sessions) {
      if (s.started_by === userId) continue
      if (dismissed.has(s.id)) continue

      const { data: alreadyJoined } = await supabase
        .from('call_participants')
        .select('id')
        .eq('session_id', s.id)
        .eq('user_id', userId)
        .maybeSingle()
      if (alreadyJoined) continue

      const conv = Array.isArray(s.conversation) ? s.conversation[0] : s.conversation
      const starter = Array.isArray(s.starter) ? s.starter[0] : s.starter
      if (!conv || !starter) continue

      const isChannel = conv.type === 'channel' || conv.type === 'voice_channel'
      const payload: IncomingCallPayload = {
        sessionId: s.id,
        conversationId: s.conversation_id,
        roomName: s.livekit_room_name,
        modality: s.modality as CallModality,
        channelName: isChannel ? (conv.name ?? null) : null,
        fromUser: {
          id: starter.id,
          full_name: starter.full_name,
          avatar_url: starter.avatar_url ?? null,
        },
      }
      console.info('[useIncomingCall] catch-up recovered missed call', s.id)
      setIncoming(payload)
      return
    }
  } catch (err) {
    console.error('[useIncomingCall] catch-up failed:', err)
  }
}
