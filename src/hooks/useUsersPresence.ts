'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { EffectivePresenceStatus, PresenceStatus } from '@/types/db'

interface ActiveCallRow {
  user_id: string
  session_id: string
  left_at: string | null
  session: {
    id: string
    conversation_id: string
    ended_at: string | null
  }
}

interface PresenceRow {
  user_id: string
  status: PresenceStatus
  updated_at: string
  status_emoji: string | null
  status_message: string | null
}

export interface UserStatusMessage {
  emoji: string | null
  message: string | null
}

// Si el usuario no ha refrescado su presencia en más de 35 minutos, se considera offline.
const STALE_MS = 35 * 60 * 1000

/**
 * Resultado del hook: por cada user_id devuelve el estado efectivo
 * (manual + override "en_llamada" si está en una sesión activa).
 *
 * Suscribe realtime a:
 *   - user_presence (manual status changes)
 *   - call_participants (entradas/salidas de llamadas)
 *
 * Refrescos minimales — solo refetcha cuando hay un cambio real.
 */
export function useUsersPresence() {
  const [presence, setPresence] = useState<Map<string, PresenceStatus>>(new Map())
  const [presenceUpdatedAt, setPresenceUpdatedAt] = useState<Map<string, string>>(new Map())
  const [statusMessages, setStatusMessages] = useState<Map<string, UserStatusMessage>>(new Map())
  const [inCall, setInCall] = useState<Set<string>>(new Set())
  const [activeConvCalls, setActiveConvCalls] = useState<Set<string>>(new Set())

  // ID único por instancia del hook — evita colisión de nombres de canal
  // cuando varios componentes usan useUsersPresence simultáneamente.
  const instanceId = useRef<string>('')
  if (!instanceId.current) {
    instanceId.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10)
  }

  const refresh = useCallback(async () => {
    try {
      const supabase = createClient()

      // Manual presence + status descriptivo libre
      const { data: presRows } = await supabase
        .from('user_presence')
        .select('user_id, status, updated_at, status_emoji, status_message')
      const presMap = new Map<string, PresenceStatus>()
      const updMap = new Map<string, string>()
      const msgMap = new Map<string, UserStatusMessage>()
      for (const r of (presRows ?? []) as PresenceRow[]) {
        presMap.set(r.user_id, r.status)
        updMap.set(r.user_id, r.updated_at)
        if (r.status_emoji || r.status_message) {
          msgMap.set(r.user_id, { emoji: r.status_emoji, message: r.status_message })
        }
      }
      setPresence(presMap)
      setPresenceUpdatedAt(updMap)
      setStatusMessages(msgMap)

      // En llamada: usuarios con un call_participants row sin left_at sobre
      // una sesión sin ended_at.
      const { data: activeRows } = await supabase
        .from('call_participants')
        .select('user_id, session_id, left_at, session:call_sessions!inner(id, conversation_id, ended_at)')
        .is('left_at', null)
        .is('session.ended_at', null)

      const inCallSet = new Set<string>()
      const convCallSet = new Set<string>()
      for (const r of (activeRows ?? []) as unknown as ActiveCallRow[]) {
        inCallSet.add(r.user_id)
        if (r.session?.conversation_id) {
          convCallSet.add(r.session.conversation_id)
        }
      }
      setInCall(inCallSet)
      setActiveConvCalls(convCallSet)
    } catch (e) {
      console.warn('[useUsersPresence] refresh falló:', e)
    }
  }, [])

  useEffect(() => {
    const supabase = createClient()
    refresh()

    const presenceChannel = supabase.channel(`presence-watch-${instanceId.current}`)
    presenceChannel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_presence' },
      refresh
    )
    presenceChannel.subscribe()

    const callsChannel = supabase.channel(`calls-presence-watch-${instanceId.current}`)
    callsChannel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'call_participants' },
      refresh
    )
    callsChannel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'call_sessions' },
      refresh
    )
    callsChannel.subscribe()

    // Safety poll cada 60s — robustez si el WebSocket se desconecta.
    const safetyTimer = window.setInterval(refresh, 60_000)

    return () => {
      window.clearInterval(safetyTimer)
      presenceChannel.unsubscribe()
      callsChannel.unsubscribe()
    }
  }, [refresh])

  /** Estado efectivo: en_llamada override sobre el manual. Offline si no hay fila o si está inactivo >35 min. */
  const getEffective = useCallback(
    (userId: string): EffectivePresenceStatus => {
      if (inCall.has(userId)) return 'en_llamada'
      const status = presence.get(userId)
      if (!status) return 'offline'
      const lastSeen = presenceUpdatedAt.get(userId)
      if (!lastSeen || Date.now() - new Date(lastSeen).getTime() > STALE_MS) return 'offline'
      return status
    },
    [inCall, presence, presenceUpdatedAt]
  )

  /** True si la conversación tiene una sesión de llamada activa. */
  const isConvInCall = useCallback(
    (conversationId: string): boolean => activeConvCalls.has(conversationId),
    [activeConvCalls]
  )

  /** Status descriptivo libre del usuario (emoji + texto), o null si no tiene. */
  const getStatusMessage = useCallback(
    (userId: string): UserStatusMessage | null => statusMessages.get(userId) ?? null,
    [statusMessages]
  )

  return { presence, inCall, activeConvCalls, getEffective, getStatusMessage, isConvInCall, refresh }
}
