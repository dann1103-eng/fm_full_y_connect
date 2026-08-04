'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotificationItem } from '@/types/db'
import { createClient } from '@/lib/supabase/client'

// Safety poll: cada minuto. Antes 15s era demasiado agresivo — 4 fetches/min/user
// solo de polling, multiplicado por usuarios concurrentes saturaba la query de
// requirement_mentions (que tiene LATERAL JOINs nested y aparece como #3 mas
// lenta del sistema).
const SAFETY_POLL_MS = 60_000
// Debounce alto para absorber rafagas de eventos postgres_changes: cuando alguien
// envia 5 mensajes, time_entries cambia varias veces, etc., no queremos un
// fetch por cada evento.
const DEBOUNCE_MS = 2_000
// Cuanto tiempo debe pasar desde el ultimo fetch para que un visibilitychange
// dispare un refetch (en vez de hacerlo en cada vuelta a la pestaña).
const VISIBILITY_REFETCH_MIN_AGE_MS = 30_000
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
  const lastFetchAtRef = useRef<number>(0)

  useEffect(() => {
    setDismissal(readDismissal())
    setLocalDismissed(new Set(Object.keys(readLocalDismissal())))
  }, [])

  const fetchItems = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    lastFetchAtRef.current = Date.now()
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

    // Todos los listeners usan scheduleFetch (con debounce de 2s) para
    // absorber rafagas. Antes la mayoria llamaba fetchItems directo, lo cual
    // generaba un fetch por evento — con 10 usuarios chateando + cambiando
    // time_entries era la causa principal del slow query #3.
    const channel = supabase
      .channel(`notifications-feed-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requirement_mentions' }, scheduleFetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'review_comment_mentions' }, scheduleFetch)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, scheduleFetch)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members' }, scheduleFetch)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'requirements' }, scheduleFetch)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'time_entries' }, scheduleFetch)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'time_entries' }, scheduleFetch)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'invoices' }, scheduleFetch)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'requirement_cambio_logs' }, scheduleFetch)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'requirement_cambio_logs' }, scheduleFetch)
      .subscribe()

    safetyTimer = setInterval(fetchItems, SAFETY_POLL_MS)

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      // Solo refetch al volver la pestaña si paso suficiente tiempo desde el
      // ultimo fetch — sino, cada cambio de tab generaba una request.
      const age = Date.now() - lastFetchAtRef.current
      if (age >= VISIBILITY_REFETCH_MIN_AGE_MS) fetchItems()
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
    if (it.kind === 'cambio_pending') return sum + 1
    if (it.kind === 'wa_handoff') return sum + 1
    if (it.kind === 'wa_window_closing') return sum + 1
    if (it.kind === 'pending_request') return sum + 1
    if (it.kind === 'task_assigned' || it.kind === 'task_completed') return sum + 1
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
