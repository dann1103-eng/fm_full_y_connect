'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useUserOrNull } from '@/contexts/UserContext'
import { claimSession, verifySession } from '@/app/actions/sessions'
import { SessionKickedDialog } from './SessionKickedDialog'

const STORAGE_KEY = 'fm_session_id'
const POLL_MS = 30_000

/**
 * Vigila el `current_session_id` del usuario actual.
 * - Al montar: si no hay session_id en localStorage, llama claimSession() para
 *   reclamar uno nuevo. Esto cubre tanto password login como magic link.
 * - Suscribe realtime sobre `users` (filtrado por id) y compara los UPDATE
 *   contra el id local. Si difieren → este dispositivo fue expulsado.
 * - Polling de respaldo cada 30s + on `visibilitychange`.
 */
export function SessionSentinel() {
  const user = useUserOrNull()
  const [kicked, setKicked] = useState(false)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    let cleanup: (() => void) | null = null

    async function setup() {
      // 1) Asegurar session id local
      let localId: string | null = null
      try {
        localId = localStorage.getItem(STORAGE_KEY)
      } catch {
        /* ignore */
      }
      if (!localId) {
        const res = await claimSession()
        if ('ok' in res) {
          localId = res.sessionId
          try {
            localStorage.setItem(STORAGE_KEY, localId)
          } catch {
            /* ignore */
          }
        }
      }
      if (cancelled || !localId) return
      const myUserId = user!.id

      // 2) Realtime: detectar UPDATE de users con id mío y comparar
      const supabase = createClient()
      const channel = supabase
        .channel(`session-sentinel-${myUserId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'users',
            filter: `id=eq.${myUserId}`,
          },
          (payload) => {
            const newId = (payload.new as { current_session_id: string | null })
              .current_session_id
            if (newId && newId !== localId) {
              setKicked(true)
            }
          },
        )
        .subscribe()

      // 3) Polling de respaldo. Solo expulsar si la BD confirma OTRA sesión
      //    (`superseded`). Un `unknown` (auth transitorio / red) NO debe
      //    expulsar: causaba falsos positivos en la única sesión legítima.
      const poll = window.setInterval(async () => {
        const { status } = await verifySession(localId!)
        if (status === 'superseded') setKicked(true)
      }, POLL_MS)

      // 4) On visibility change → revalidar
      const onVis = async () => {
        if (document.visibilityState !== 'visible') return
        const { status } = await verifySession(localId!)
        if (status === 'superseded') setKicked(true)
      }
      document.addEventListener('visibilitychange', onVis)

      cleanup = () => {
        window.clearInterval(poll)
        document.removeEventListener('visibilitychange', onVis)
        supabase.removeChannel(channel)
      }
    }

    void setup()

    return () => {
      cancelled = true
      if (cleanup) cleanup()
    }
  }, [user])

  return <SessionKickedDialog open={kicked} />
}
