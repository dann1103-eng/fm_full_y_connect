'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConversationListItem, MessageWithMeta } from '@/types/db'

const POLL_INTERVAL_MS = 12_000

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

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox/list', { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as ConversationListItem[]
      setData(json)
    } catch {
      // silent: polling
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    refresh()
    const id = window.setInterval(refresh, POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [visible, refresh])

  return { data, loading, refresh }
}

export function useConversationMessages(
  conversationId: string,
  initial?: MessageWithMeta[]
) {
  const [messages, setMessages] = useState<MessageWithMeta[]>(initial ?? [])
  const [loading, setLoading] = useState<boolean>(!initial)
  const visible = useVisible()
  const lastCreatedAtRef = useRef<string | null>(
    initial && initial.length > 0 ? initial[initial.length - 1].created_at : null
  )

  useEffect(() => {
    setMessages(initial ?? [])
    lastCreatedAtRef.current = initial && initial.length > 0 ? initial[initial.length - 1].created_at : null
  }, [conversationId, initial])

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
      // silent: polling
    } finally {
      setLoading(false)
    }
  }, [conversationId])

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/inbox/${conversationId}/messages?limit=50`, { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as MessageWithMeta[]
      setMessages(json)
      lastCreatedAtRef.current = json.length > 0 ? json[json.length - 1].created_at : null
    } catch {
      // silent
    }
  }, [conversationId])

  useEffect(() => {
    if (!visible) return
    fetchIncremental()
    const id = window.setInterval(fetchIncremental, POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [visible, fetchIncremental])

  const removeMessage = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId))
  }, [])

  const updateMessage = useCallback((messageId: string, patch: Partial<MessageWithMeta>) => {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, ...patch } : m)))
  }, [])

  return { messages, loading, refresh, removeMessage, updateMessage }
}
