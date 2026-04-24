'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotificationItem } from '@/types/db'
import { createClient } from '@/lib/supabase/client'

const SAFETY_POLL_MS = 60_000
const DEBOUNCE_MS = 400
const DISMISSAL_KEY = 'overdue-seen'

type DismissalMap = Record<string, string>

function readDismissal(): DismissalMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(DISMISSAL_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as DismissalMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeDismissal(map: DismissalMap) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DISMISSAL_KEY, JSON.stringify(map))
  } catch {
    /* quota or disabled storage — no-op */
  }
}

export function useNotifications() {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [dismissal, setDismissal] = useState<DismissalMap>({})
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setDismissal(readDismissal())
  }, [])

  const fetchItems = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store', signal: ctrl.signal })
      if (!res.ok) return
      const data = (await res.json()) as NotificationItem[]
      setItems(data)
    } catch {
      /* ignore aborted / offline */
    } finally {
      setLoading(false)
    }
  }, [])

  const scheduleFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchItems()
    }, DEBOUNCE_MS)
  }, [fetchItems])

  useEffect(() => {
    const supabase = createClient()
    let safetyTimer: ReturnType<typeof setInterval> | null = null

    fetchItems()

    const channel = supabase
      .channel(`notifications-feed-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requirement_mentions' }, fetchItems)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, fetchItems)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members' }, fetchItems)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'requirements' }, scheduleFetch)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'time_entries' }, scheduleFetch)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'time_entries' }, scheduleFetch)
      .subscribe()

    safetyTimer = setInterval(fetchItems, SAFETY_POLL_MS)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchItems()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (safetyTimer) clearInterval(safetyTimer)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      document.removeEventListener('visibilitychange', onVisibility)
      supabase.removeChannel(channel)
      abortRef.current?.abort()
    }
  }, [fetchItems, scheduleFetch])

  const markOverdueSeen = useCallback(() => {
    setItems((current) => {
      const next: DismissalMap = { ...readDismissal() }
      for (const it of current) {
        if (it.kind === 'overdue' && it.overdue_requirement_id) {
          next[it.overdue_requirement_id] = it.created_at
        }
      }
      writeDismissal(next)
      setDismissal(next)
      return current
    })
  }, [])

  const dismissOverdue = useCallback((requirementId: string, createdAt: string) => {
    const next: DismissalMap = { ...readDismissal(), [requirementId]: createdAt }
    writeDismissal(next)
    setDismissal(next)
  }, [])

  const dismissAllOverdue = useCallback(() => {
    setItems((current) => {
      const next: DismissalMap = { ...readDismissal() }
      for (const it of current) {
        if (it.kind === 'overdue' && it.overdue_requirement_id) {
          next[it.overdue_requirement_id] = it.created_at
        }
      }
      writeDismissal(next)
      setDismissal(next)
      return current
    })
  }, [])

  const isOverdueDismissed = useCallback(
    (it: NotificationItem): boolean => {
      if (it.kind !== 'overdue') return false
      const id = it.overdue_requirement_id
      return !!id && dismissal[id] === it.created_at
    },
    [dismissal],
  )

  const visibleItems = items.filter((it) => !isOverdueDismissed(it))

  const unreadCount = items.reduce((sum, it) => {
    if (it.kind === 'overdue') {
      if (isOverdueDismissed(it)) return sum
      return sum + 1
    }
    if (it.kind === 'mention') return sum + (it.read ? 0 : 1)
    if (it.kind === 'calendar') return sum + 1
    return sum + (it.unread_count ?? 0)
  }, 0)

  return {
    items: visibleItems,
    allItems: items,
    unreadCount,
    loading,
    refresh: fetchItems,
    markOverdueSeen,
    dismissOverdue,
    dismissAllOverdue,
  }
}
