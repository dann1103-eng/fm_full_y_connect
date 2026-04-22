'use client'

import { useCallback } from 'react'
import { useNotificationToasts } from '@/hooks/useNotificationToasts'
import { NotificationToast } from './NotificationToast'

export function NotificationToastHost() {
  const { toasts, dismiss } = useNotificationToasts()

  const handleDismiss = useCallback((id: string) => dismiss(id), [dismiss])

  if (toasts.length === 0) return null

  return (
    <>
      {toasts.map((toast, index) => (
        <NotificationToast
          key={toast.id}
          toast={toast}
          index={index}
          onDismiss={handleDismiss}
        />
      ))}
    </>
  )
}
