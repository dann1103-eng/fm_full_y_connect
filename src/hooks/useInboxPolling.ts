'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConversationListItem, MessageWithMeta } from '@/types/db'
import { createClient } from '@/lib/supabase/client'

// Safety poll: backup en caso que falle realtime. 30s es suficiente para
// que un usuario sienta el chat "vivo" sin hammerear Supabase con 6 requests/min.
const SAFETY_POLL_MS = 30_000
// Debounce para absorber bursts de eventos postgres_changes — sin esto, una
// rafaga de mensajes simultaneos generaba un fetch por evento.
const DEBOUNCE_MS = 1500

function useVisible(): boolean {
  const [visible, setVisible] = useState<boolean>(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  )
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

export function useInboxList(initial?: ConversationListItem[]) {
  const [data, setData] = useState<ConversationListItem[]>(initial ?? [])
  const [loading, setLoading] = useState<boolean>(!initial)
  const visible = useVisible()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox/list', { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as ConversationListItem[]
      setData(json)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      refresh()
    }, DEBOUNCE_MS)
  }, [refresh])

  useEffect(() => {
    if (!visible) return
    const supabase = createClient()

    refresh()

    // Usamos scheduleRefresh (con debounce) en vez de refresh directo: si llegan
    // 5 eventos en 1 segundo, hacemos 1 fetch en lugar de 5.
    const channel = supabase
      .channel(`inbox-list-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, scheduleRefresh)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members' }, scheduleRefresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations' }, scheduleRefresh)
      .subscribe()

    const safetyTimer = window.setInterval(refresh, SAFETY_POLL_MS)

    return () => {
      window.clearInterval(safetyTimer)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [visible, refresh, scheduleRefresh])

  return { data, loading, refresh }
}

export function useConversationMessages(
  conversationId: string,
  initial?: MessageWithMeta[],
  initialDayKey?: string | null,
  initialHasMoreBefore?: boolean
) {
  const [messages, setMessages] = useState<MessageWithMeta[]>(initial ?? [])
  const [loading, setLoading] = useState<boolean>(!initial)
  const [earliestDayKey, setEarliestDayKey] = useState<string | null>(initialDayKey ?? null)
  const [hasMoreBefore, setHasMoreBefore] = useState<boolean>(initialHasMoreBefore ?? false)
  const [loadingPrevious, setLoadingPrevious] = useState(false)
  const visible = useVisible()
  const lastCreatedAtRef = useRef<string | null>(
    initial && initial.length > 0 ? initial[initial.length - 1].created_at : null
  )

  useEffect(() => {
    setMessages(initial ?? [])
    lastCreatedAtRef.current = initial && initial.length > 0 ? initial[initial.length - 1].created_at : null
    setEarliestDayKey(initialDayKey ?? null)
    setHasMoreBefore(initialHasMoreBefore ?? false)
  }, [conversationId, initial, initialDayKey, initialHasMoreBefore])

  const fetchIncremental = useCallback(async () => {
    try {
      const since = lastCreatedAtRef.current
      const url = since
        ? `/api/inbox/${conversationId}/messages?since=${encodeURIComponent(since)}`
        : `/api/inbox/${conversationId}/messages`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as MessageWithMeta[]
      if (json.length === 0) return
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id))
        const toAppend = json.filter((m) => !known.has(m.id))
        if (toAppend.length === 0) return prev
        const next = [...prev, ...toAppend]
        lastCreatedAtRef.current = next[next.length - 1].created_at
        return next
      })
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [conversationId])

  /**
   * `refresh` ahora carga el último día con mensajes (mismo modelo que la
   * página principal del inbox). Antes traía los últimos 50 sin discriminar
   * — esto se usa cuando no hay `initial` (e.g., FloatingChatBubble).
   */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/inbox/${conversationId}/messages?initialDay=true`,
        { cache: 'no-store' }
      )
      if (!res.ok) return
      const json = (await res.json()) as {
        messages: MessageWithMeta[]
        dayKey: string | null
        hasMoreBefore: boolean
      }
      setMessages(json.messages)
      lastCreatedAtRef.current =
        json.messages.length > 0 ? json.messages[json.messages.length - 1].created_at : null
      setEarliestDayKey(json.dayKey)
      setHasMoreBefore(json.hasMoreBefore)
    } catch {
      // silent
    }
  }, [conversationId])

  /**
   * Carga el último día calendario con mensajes ESTRICTAMENTE anterior al
   * `earliestDayKey` actual. Si no hay día previo, marca `hasMoreBefore=false`.
   * Devuelve la cantidad de mensajes nuevos prepended para que el caller
   * pueda preservar el scroll position del usuario.
   */
  const loadPreviousDay = useCallback(async (): Promise<number> => {
    if (!earliestDayKey || !hasMoreBefore || loadingPrevious) return 0
    setLoadingPrevious(true)
    try {
      const url = `/api/inbox/${conversationId}/messages?beforeDay=${encodeURIComponent(earliestDayKey)}`
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return 0
      const json = (await res.json()) as {
        messages: MessageWithMeta[]
        dayKey: string | null
        hasMoreBefore: boolean
      }
      if (!json.dayKey || json.messages.length === 0) {
        setHasMoreBefore(false)
        return 0
      }
      let prependedCount = 0
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id))
        const toPrepend = json.messages.filter((m) => !known.has(m.id))
        prependedCount = toPrepend.length
        if (toPrepend.length === 0) return prev
        return [...toPrepend, ...prev]
      })
      setEarliestDayKey(json.dayKey)
      setHasMoreBefore(json.hasMoreBefore)
      return prependedCount
    } catch {
      return 0
    } finally {
      setLoadingPrevious(false)
    }
  }, [conversationId, earliestDayKey, hasMoreBefore, loadingPrevious])

  // ID estable del canal por mount (evita suscripciones huérfanas en StrictMode).
  const channelIdRef = useRef<string>('')
  if (!channelIdRef.current) {
    channelIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2)
  }

  useEffect(() => {
    if (!visible) return
    const supabase = createClient()

    // Hidratar de una sola vez (refresh) — evita race con INSERTs realtime tempranos
    // y deja `lastCreatedAtRef` con timestamp actual para fetchIncremental subsiguientes.
    refresh()

    // [REALTIME-DIAG] Logs de diagnóstico (Fase 1) — eliminar tras estabilizar.
    const diagPrefix = `[rt conv ${conversationId.slice(0, 8)}]`
    console.info(diagPrefix, 'subscribing', new Date().toISOString())

    const channel = supabase.channel(`conv-messages-${conversationId}-${channelIdRef.current}`)
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        const row = payload.new as { conversation_id?: string; id?: string; created_at?: string }
        const commitTs = (payload as { commit_timestamp?: string }).commit_timestamp
        const matches = row.conversation_id === conversationId
        const latencyMs = commitTs ? Date.now() - new Date(commitTs).getTime() : null
        console.info(
          diagPrefix,
          'INSERT recibido',
          { matches, msgId: row.id?.slice(0, 8), commitTs, latencyMs, now: new Date().toISOString() }
        )
        if (matches) fetchIncremental()
      }
    )
    channel.on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'messages' },
      (payload) => {
        const old = payload.old as { id?: string; conversation_id?: string }
        if (old.conversation_id === conversationId && old.id) {
          setMessages((prev) => prev.filter((m) => m.id !== old.id))
        }
      }
    )
    channel.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'messages' },
      (payload) => {
        const row = payload.new as { conversation_id?: string }
        if (row.conversation_id === conversationId) refresh()
      }
    )
    channel.subscribe((status, err) => {
      console.info(diagPrefix, 'subscribe status:', status, err ?? '', new Date().toISOString())
    })

    const safetyTimer = window.setInterval(() => {
      console.info(diagPrefix, 'safety poll fire', new Date().toISOString())
      fetchIncremental()
    }, SAFETY_POLL_MS)

    return () => {
      console.info(diagPrefix, 'unsubscribing', new Date().toISOString())
      window.clearInterval(safetyTimer)
      channel.unsubscribe()
    }
  }, [visible, conversationId, fetchIncremental, refresh])

  const removeMessage = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId))
  }, [])

  const updateMessage = useCallback((messageId: string, patch: Partial<MessageWithMeta>) => {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, ...patch } : m)))
  }, [])

  const addLocalMessage = useCallback((msg: MessageWithMeta) => {
    setMessages((prev) => [...prev, msg])
  }, [])

  return {
    messages,
    loading,
    refresh,
    removeMessage,
    updateMessage,
    addLocalMessage,
    loadPreviousDay,
    hasMoreBefore,
    loadingPrevious,
  }
}
