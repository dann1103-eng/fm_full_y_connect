'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/contexts/UserContext'

const STORAGE_KEY = 'solicitudes_especiales_last_seen'

/**
 * Devuelve el número de solicitudes + notas nuevas (de la otra persona) desde
 * la última vez que el usuario visitó /solicitudes-dev.
 * Se resetea a 0 al entrar a esa ruta.
 * Hace polling cada 30 segundos.
 */
export function useDevRequestsBadge(): number {
  const user    = useUser()
  const pathname = usePathname()
  const [count, setCount] = useState(0)

  // ── Limpiar al entrar a la página ──────────────────────────────────────────
  useEffect(() => {
    if (pathname === '/solicitudes-dev') {
      try {
        localStorage.setItem(STORAGE_KEY, new Date().toISOString())
      } catch { /* SSR / cookie-blocked */ }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCount(0)
    }
  }, [pathname])

  // ── Fetch + polling ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user.can_request_dev) return

    const supabase = createClient()

    async function fetchCount() {
      let lastSeen = '1970-01-01T00:00:00.000Z'
      try { lastSeen = localStorage.getItem(STORAGE_KEY) ?? lastSeen } catch { /* noop */ }

      // Solicitudes nuevas dirigidas a mí
      const { count: reqCount } = await supabase
        .from('dev_requests')
        .select('id', { count: 'exact', head: true })
        .eq('target_user_id', user.id)
        .gt('created_at', lastSeen)

      // Notas nuevas de la otra persona en solicitudes donde participo
      // (RLS filtra automáticamente a las solicitudes en las que el usuario está involucrado)
      const { count: noteCount } = await supabase
        .from('dev_request_notes')
        .select('id', { count: 'exact', head: true })
        .neq('created_by', user.id)
        .gt('created_at', lastSeen)

      setCount((reqCount ?? 0) + (noteCount ?? 0))
    }

    fetchCount()
    const interval = setInterval(fetchCount, 30_000)
    return () => clearInterval(interval)
  }, [user.id, user.can_request_dev])

  return count
}
