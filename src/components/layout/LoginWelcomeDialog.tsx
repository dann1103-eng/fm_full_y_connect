'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/contexts/UserContext'
import { getMyActiveShift, startShift } from '@/app/actions/work-sessions'
import { notifyShiftChanged } from '@/hooks/useActiveShift'
import { useBrowserNotifications } from '@/hooks/useBrowserNotifications'

function todayKey(userId: string): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `fm-welcome-shown-${userId}-${y}-${m}-${day}`
}

/**
 * Modal de bienvenida tras el primer load del día.
 * - Muestra una sola vez por día por usuario (vía localStorage).
 * - Si ya hay una jornada activa, NO se muestra (pero sí pide permiso de browser notifs).
 * - Solo aplica a staff (no clientes).
 */
export function LoginWelcomeDialog() {
  const user = useUser()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const { requestPermission } = useBrowserNotifications()

  useEffect(() => {
    if (!user || user.role === 'client') return
    if (typeof window === 'undefined') return
    const key = todayKey(user.id)
    if (window.localStorage.getItem(key)) return // ya marcado hoy

    let cancelled = false
    getMyActiveShift().then((s) => {
      if (cancelled) return
      window.localStorage.setItem(key, '1')
      if (s) {
        // Ya hay jornada — no abrir modal pero sí pedir permiso de notif
        requestPermission().catch(() => {})
        return
      }
      setOpen(true)
    })
    return () => {
      cancelled = true
    }
  }, [user, requestPermission])

  function close(askPermission: boolean) {
    setOpen(false)
    if (askPermission) {
      requestPermission().catch(() => {})
    }
  }

  function handleStartShift() {
    setError(null)
    startTransition(async () => {
      const r = await startShift()
      if ('error' in r) {
        setError(r.error)
        return
      }
      // Sincroniza el widget del header y la página de tiempo al instante.
      notifyShiftChanged()
      close(true)
      router.refresh()
    })
  }

  if (!open) return null

  const firstName = (user.full_name || user.email || '').split(' ')[0] || 'staff'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-fm-surface-container-lowest rounded-3xl shadow-2xl p-6 max-w-md w-full space-y-4 border border-fm-surface-container-high">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-fm-primary/10 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-fm-primary text-2xl">wb_sunny</span>
          </div>
          <div>
            <p className="text-lg font-extrabold text-fm-on-surface">¡Buen día, {firstName}!</p>
            <p className="text-xs text-fm-on-surface-variant">
              {new Date().toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
        </div>

        <p className="text-sm text-fm-on-surface-variant">
          ¿Listo para iniciar tu jornada laboral? Tu tiempo online empezará a contar
          y podrás registrar pausas de almuerzo y away cuando lo necesites.
        </p>

        {error && (
          <p className="text-xs text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">
            {error}
          </p>
        )}

        <div className="flex gap-3 justify-end pt-2">
          <button
            type="button"
            onClick={() => close(true)}
            className="px-4 py-2 rounded-full text-sm font-semibold text-fm-on-surface-variant border border-fm-surface-container-high hover:bg-fm-surface-container-low transition-colors"
          >
            Ahora no
          </button>
          <button
            type="button"
            onClick={handleStartShift}
            disabled={isPending}
            className="px-5 py-2 rounded-full text-white font-bold text-sm disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
          >
            {isPending ? 'Iniciando…' : 'Iniciar jornada'}
          </button>
        </div>
      </div>
    </div>
  )
}
