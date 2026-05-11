'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { useUserOrNull } from '@/contexts/UserContext'

interface ShiftStartedPayload {
  userId: string
  fullName: string
  avatarUrl: string | null
  role: string
  at: string
}

interface ToastItem {
  id: string
  payload: ShiftStartedPayload
}

const TOAST_DURATION_MS = 5000

/**
 * Escucha broadcasts `shift_started` en el canal `team-presence` y para cada
 * inicio de jornada del equipo interno:
 *   1. Reproduce un sonido tipo timbre (/sounds/login.mp3, fallback notification.mp3).
 *   2. Muestra un toast "X está online" durante 5 segundos.
 *
 * Solo escucha — no emite. El broadcast se origina en la server action
 * `startShift` (work-sessions.ts). Excluye al usuario actual (no se notifica
 * a sí mismo) y a clientes/bots.
 */
export function TeamShiftNotificationHost() {
  const me = useUserOrNull()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    if (!me) return
    const supabase = createClient()
    const channel = supabase
      .channel('team-presence', { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'shift_started' }, (msg) => {
        const payload = msg.payload as ShiftStartedPayload
        if (!payload || !payload.userId) return
        if (payload.userId === me.id) return
        if (payload.role === 'client' || payload.role === 'agent') return

        const id = `${payload.userId}-${payload.at}`
        setToasts((prev) => {
          if (prev.some((t) => t.id === id)) return prev
          return [...prev, { id, payload }]
        })
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id))
        }, TOAST_DURATION_MS)

        // Play sound (best-effort: autoplay policies pueden bloquear si no
        // hubo interacción del usuario en la pestaña aún)
        try {
          if (!audioRef.current) {
            audioRef.current = new Audio('/sounds/login.mp3')
            audioRef.current.volume = 0.4
            audioRef.current.onerror = () => {
              // Fallback al sonido genérico de notificación si /login.mp3 no existe
              if (audioRef.current) {
                audioRef.current.src = '/sounds/notification.mp3'
              }
            }
          }
          audioRef.current.currentTime = 0
          void audioRef.current.play().catch(() => {
            /* autoplay bloqueado, silencio */
          })
        } catch {
          /* ignore */
        }
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [me])

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-3 px-4 py-2.5 bg-fm-surface-container-lowest border border-fm-primary/30 rounded-2xl shadow-xl animate-in slide-in-from-right-4 min-w-[240px]"
        >
          <UserAvatar
            name={t.payload.fullName ?? '?'}
            avatarUrl={t.payload.avatarUrl}
            size="sm"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-fm-on-surface truncate leading-tight">
              {t.payload.fullName}
            </p>
            <p className="text-xs text-fm-primary leading-tight flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-fm-primary inline-block" />
              está online
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
