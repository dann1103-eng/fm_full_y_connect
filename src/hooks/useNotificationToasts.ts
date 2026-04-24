'use client'

import { useEffect, useRef, useState } from 'react'
import { useNotifications } from './useNotifications'
import { useUser } from '@/contexts/UserContext'
import { createClient } from '@/lib/supabase/client'
import type { NotificationItem } from '@/types/db'

export interface ToastItem {
  id: string
  notification: NotificationItem
  href: string
}

function buildHref(item: NotificationItem): string {
  if (item.kind === 'overdue' && item.overdue_requirement_id) {
    return `/pipeline?req=${item.overdue_requirement_id}`
  }
  if (item.kind === 'mention') {
    if (item.mention_source === 'review' && item.client_id && item.requirement_id) {
      const params = new URLSearchParams()
      params.set('req', item.requirement_id)
      params.set('tab', 'revision')
      if (item.review_pin_id) params.set('pin', item.review_pin_id)
      return `/clients/${item.client_id}?${params.toString()}`
    }
    if (item.requirement_id) return `/pipeline?req=${item.requirement_id}`
    return '/pipeline'
  }
  if (item.kind === 'calendar') return '/calendario'
  if (item.conversation_id) return `/inbox/${item.conversation_id}`
  return '/inbox'
}

const NOTIFICATION_SOUND = '/sounds/notification.mp3'
const INBOX_SOUND = '/sounds/inbox.mp3'

export function useNotificationToasts() {
  const user = useUser()
  const { items, loading, refresh } = useNotifications()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const seenIdsRef = useRef<Set<string>>(new Set())
  const initializedRef = useRef(false)
  const notifAudioRef = useRef<HTMLAudioElement | null>(null)
  const inboxAudioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const na = new Audio(NOTIFICATION_SOUND)
    na.preload = 'auto'
    na.volume = 0.4
    notifAudioRef.current = na

    const ia = new Audio(INBOX_SOUND)
    ia.preload = 'auto'
    ia.volume = 0.4
    inboxAudioRef.current = ia
  }, [])

  // Backup direct subscription — forces refresh when a message arrives from another user,
  // guarding against race conditions between Supabase Realtime and the notifications API.
  useEffect(() => {
    if (!user?.id) return
    const supabase = createClient()
    const channel = supabase
      .channel(`toast-backup-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const msg = payload.new as { user_id?: string }
        if (msg.user_id && msg.user_id !== user.id) {
          refresh()
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user?.id, refresh])

  useEffect(() => {
    const key = (it: NotificationItem) => `${it.id}:${it.created_at}`

    if (!initializedRef.current) {
      if (loading) return // esperar a que el primer fetch complete
      for (const it of items) seenIdsRef.current.add(key(it))
      initializedRef.current = true
      return
    }

    const newItems = items.filter(
      (it) => !seenIdsRef.current.has(key(it)) && (it.kind === 'mention' || it.kind === 'dm' || it.kind === 'channel' || it.kind === 'calendar')
    )
    if (newItems.length === 0) return

    for (const it of newItems) seenIdsRef.current.add(key(it))

    const hasInbox = newItems.some((it) => it.kind === 'dm' || it.kind === 'channel')
    if (hasInbox) {
      inboxAudioRef.current?.play().catch(() => {})
    } else {
      notifAudioRef.current?.play().catch(() => {})
    }

    const incoming: ToastItem[] = newItems.map((it) => ({
      id: `toast-${it.id}-${Date.now()}`,
      notification: it,
      href: buildHref(it),
    }))

    setToasts((prev) => [...prev, ...incoming].slice(-3))
  }, [items])

  const dismiss = (toastId: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== toastId))
  }

  return { toasts, dismiss }
}
