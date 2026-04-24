'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { ToastItem } from '@/hooks/useNotificationToasts'
import type { NotificationItem } from '@/types/db'

const AUTO_CLOSE_MS = 5000

interface NotificationToastProps {
  toast: ToastItem
  index: number
  onDismiss: (id: string) => void
}

function kindIcon(kind: NotificationItem['kind']) {
  if (kind === 'dm' || kind === 'channel') {
    return (
      <svg className="w-4 h-4 text-[#00675c]" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM9 11H7V9h2v2zm4 0h-2V9h2v2zm4 0h-2V9h2v2z"/>
      </svg>
    )
  }
  return (
    <svg className="w-4 h-4 text-[#b31b25]" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
    </svg>
  )
}

function kindLabel(item: NotificationItem): { title: string; body: string } {
  if (item.kind === 'dm') {
    return {
      title: item.counterpart?.full_name ?? 'Nuevo mensaje',
      body: item.last_message_preview ?? 'Te envió un mensaje directo',
    }
  }
  if (item.kind === 'channel') {
    return {
      title: item.conversation_name ? `#${item.conversation_name}` : 'Canal',
      body: item.last_message_preview ?? 'Nuevo mensaje en canal',
    }
  }
  if (item.kind === 'mention') {
    return {
      title: item.mentioned_by?.full_name ? `${item.mentioned_by.full_name} te mencionó` : 'Nueva mención',
      body: item.message_preview ?? item.requirement_title ?? '',
    }
  }
  if (item.kind === 'calendar') {
    return {
      title: item.calendar_reason === 'assigned' ? 'Te asignaron a un evento' : 'Evento próximo',
      body: item.calendar_title ?? '',
    }
  }
  return { title: 'Notificación', body: '' }
}

export function NotificationToast({ toast, index, onDismiss }: NotificationToastProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const show = requestAnimationFrame(() => setVisible(true))
    const hide = setTimeout(() => {
      setVisible(false)
      setTimeout(() => onDismiss(toast.id), 300)
    }, AUTO_CLOSE_MS)
    return () => {
      cancelAnimationFrame(show)
      clearTimeout(hide)
    }
  }, [toast.id, onDismiss])

  const { title, body } = kindLabel(toast.notification)

  return (
    <div
      style={{ top: `${16 + index * 72}px` }}
      className={`fixed left-1/2 z-[9999] -translate-x-1/2 transition-all duration-300 ${
        visible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
      }`}
    >
      <Link
        href={toast.href}
        onClick={() => onDismiss(toast.id)}
        className="flex items-center gap-3 bg-white border border-[#dfe3e6] rounded-xl shadow-lg px-4 py-3 min-w-[280px] max-w-[380px] hover:shadow-xl transition-shadow"
      >
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#f5f7f9] flex items-center justify-center">
          {kindIcon(toast.notification.kind)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-[#2a2a2a] truncate">{title}</p>
          {body && <p className="text-xs text-[#595c5e] truncate mt-0.5">{body}</p>}
        </div>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDismiss(toast.id) }}
          className="flex-shrink-0 text-[#595c5e] hover:text-[#2a2a2a] p-1 rounded"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </Link>
    </div>
  )
}
