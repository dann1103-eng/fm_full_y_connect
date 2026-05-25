'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface PresenceMeta {
  user_id: string
  full_name?: string | null
  avatar_url?: string | null
  online_at?: string
}

/**
 * Suscribe presence Supabase a un canal específico.
 *
 * Usos:
 *   - `org:online` → quién está conectado en general (fase 4).
 *   - `voice:{conversationId}` → quién está dentro del canal de voz (fase 3).
 *
 * `track` controla si este cliente debe registrarse como presente. Para
 * `voice:*`, solo el cliente que está dentro del room debe trackear.
 */
export function usePresence(
  channelName: string | null,
  identity: PresenceMeta | null,
  track: boolean
) {
  const [users, setUsers] = useState<PresenceMeta[]>([])

  useEffect(() => {
    if (!channelName) return
    const supabase = createClient()
    const channel = supabase.channel(channelName, {
      config: {
        presence: { key: identity?.user_id ?? 'anon' },
      },
    })

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState() as Record<string, PresenceMeta[]>
      const flat: PresenceMeta[] = []
      for (const arr of Object.values(state)) {
        if (arr.length > 0) flat.push(arr[0])
      }
      setUsers(flat)
    })
    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED' && track && identity) {
        await channel.track({
          ...identity,
          online_at: new Date().toISOString(),
        })
      }
    })

    return () => {
      channel.unsubscribe()
    }
  }, [channelName, track, identity])

  return users
}
