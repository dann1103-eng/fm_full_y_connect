'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotificationItem } from '@/types/db'
import { createClient } from '@/lib/supabase/client'

const SAFETY_POLL_MS = 15_000
const DEBOUNCE_MS = 400
const DISMISSAL_KEY = 'overdue-seen'
const LOCAL_DISMISSAL_KEY = 'notif-dismissed'

type DismissalMap = Record<string, string>

function readMap(key: string): DismissalMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as DismissalMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeMap(key: string, map: DismissalMap) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(map))
  } catch {
    /* quota or disabled storage — no-op */
  }
}

function readDismissal(): DismissalMap {
  return readMap(DISMISSAL_KEY)
}

function writeDismissal(map: DismissalMap) {
  writeMap(DISMISSAL_KEY, map)
}

function readLocalDismissal(): DismissalMap {
  return readMap(LOCAL_DISMISSAL_KEY)
}

function writeLocalDismissal(map: DismissalMap) {
  writeMap(LOCAL_DISMISSAL_KEY, map)
}

export function useNotifications() {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [dismissal, setDismissal] = useState<DismissalMap>({})
  const [localDismissed, setLocalDismissed] = useState<Set<string>>(new Set())
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setDismissal(readDismissal())
    setLocalDismissed(new Set(Object.keys(readLocalDismissal())))
  }, [])

  const fetchItems = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store', signal: ctrl.signal })
      if (!res.ok) return
      const data = (await res.json()) as NotificationItem[]
      const stored = readLocalDismissal()
      const byId = new Map(data.map((d) => [d.id, d.created_at]))
      const cleaned: DismissalMap = {}
      for (const [id, at] of Object.entries(stored)) {
        if (byId.get(id) === at) cleaned[id] = at
      }
      if (Object.keys(cleaned).length !== Object.keys(stored).length) {
        writeLocalDismissal(cleaned)
      }
      setLocalDismissed(new Set(Object.keys(cleaned)))
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'review_comment_mentions' }, fetchItems)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, fetchItems)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members' }, fetchItems)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'requirements' }, scheduleFetch)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'time_entries' }, scheduleFetch)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'time_entries' }, scheduleFetch)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'invoices' }, scheduleFetch)
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

  const localDismiss = useCallback((it: NotificationItem) => {
    setLocalDismissed((prev) => new Set(prev).add(it.id))
    writeLocalDismissal({ ...readLocalDismissal(), [it.id]: it.created_at })
  }, [])

  const localDismissAll = useCallback(() => {
    setLocalDismissed(new Set(items.map((it) => it.id)))
    const next: DismissalMap = { ...readLocalDismissal() }
    for (const it of items) next[it.id] = it.created_at
    writeLocalDismissal(next)
  }, [items])

  const visibleItems = items.filter((it) => {
    if (isOverdueDismissed(it)) return false
    if (localDismissed.has(it.id)) return false
    if (it.kind === 'mention' && it.read) return false
    return true
  })

  const unreadCount = items.reduce((sum, it) => {
    if (isOverdueDismissed(it)) return sum
    if (localDismissed.has(it.id)) return sum
    if (it.kind === 'overdue') return sum + 1
    if (it.kind === 'mention') return sum + (it.read ? 0 : 1)
    if (it.kind === 'calendar') return sum + 1
    if (it.kind === 'invoice_auto') return sum + 1
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
    localDismiss,
    localDismissAll,
  }
}
