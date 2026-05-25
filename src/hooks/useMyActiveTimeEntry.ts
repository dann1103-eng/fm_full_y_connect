'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { TimeEntry } from '@/types/db'

/**
 * Mantiene en sync la entrada de tiempo activa (`time_entries` con
 * `ended_at IS NULL`) del usuario vía realtime postgres_changes.
 *
 * Resuelve el bug de "entrada activa fantasma" cuando otra pestaña / dispositivo
 * cierra la entrada y el state local del componente queda viejo.
 *
 * Acepta `initial` como SSR seed para el primer paint sin flicker.
 */
export function useMyActiveTimeEntry(
  userId: string | null,
  initial: TimeEntry | null,
): readonly [TimeEntry | null, (next: TimeEntry | null) => void] {
  const [active, setActive] = useState<TimeEntry | null>(initial)

  useEffect(() => {
    if (!userId) return
    const supabase = createClient()

    async function refetch() {
      const { data } = await supabase
        .from('time_entries')
        .select('*')
        .eq('user_id', userId!)
        .is('ended_at', null)
        .maybeSingle()
      setActive((data as TimeEntry | null) ?? null)
    }

    const channel = supabase.channel(`time-entries-${userId}`)
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'time_entries', filter: `user_id=eq.${userId}` },
      () => { void refetch() },
    )
    channel.subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [userId])

  return [active, setActive] as const
}
