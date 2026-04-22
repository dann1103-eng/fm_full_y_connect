'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotificationItem } from '@/types/db'

const POLL_MS = 20_000
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

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      fetchItems()
      timer = setInterval(fetchItems, POLL_MS)
    }
    const stop = () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      abortRef.current?.abort()
    }
  }, [fetchItems])

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

  const unreadCount = items.reduce((sum, it) => {
    if (it.kind === 'overdue') {
      const id = it.overdue_requirement_id
      if (id && dismissal[id] === it.created_at) return sum
      return sum + 1
    }
    if (it.kind === 'mention') return sum + (it.read ? 0 : 1)
    return sum + (it.unread_count ?? 0)
  }, 0)

  return { items, unreadCount, loading, refresh: fetchItems, markOverdueSeen }
}
