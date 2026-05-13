'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { WaConversation } from '@/types/db'

interface WaConvListItem extends WaConversation {
  client?: { id: string; name: string } | null
}

interface Props {
  initial: WaConvListItem[]
}

export function WaSidebar({ initial }: Props) {
  const pathname = usePathname()
  const [items, setItems] = useState<WaConvListItem[]>(initial)
  const [filter, setFilter] = useState('')

  // Realtime: refresca cuando hay UPDATE/INSERT en wa_conversations.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('wa-conversations-sidebar')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wa_conversations' },
        () => {
          void refresh()
        },
      )
      .subscribe()

    async function refresh() {
      const { data } = await supabase
        .from('wa_conversations')
        .select('*, client:clients(id, name)')
        .order('last_message_at', { ascending: false, nullsFirst: false })
      if (data) setItems(data as unknown as WaConvListItem[])
    }

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return items
    return items.filter((c) => {
      const name = c.client?.name ?? c.display_name ?? c.phone_e164
      return name.toLowerCase().includes(q) || c.phone_e164.includes(q)
    })
  }, [filter, items])

  const activeId = pathname.startsWith('/whatsapp/') ? pathname.split('/')[2] : null

  return (
    <aside className="flex flex-col w-full sm:w-80 border-r border-fm-outline-variant/40 bg-fm-surface">
      <div className="p-3 border-b border-fm-outline-variant/30">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Buscar por nombre o número…"
          className="w-full px-3 py-2 text-sm rounded-md bg-fm-surface-container-low border border-fm-outline-variant/40 outline-none focus:border-fm-primary"
        />
      </div>

      <ul className="flex-1 overflow-y-auto divide-y divide-fm-outline-variant/30">
        {filtered.length === 0 && (
          <li className="p-6 text-sm text-fm-on-surface-variant text-center">
            {filter ? 'Sin resultados.' : 'Aún no hay conversaciones de WhatsApp.'}
          </li>
        )}
        {filtered.map((c) => {
          const title = c.client?.name ?? c.display_name ?? formatPhone(c.phone_e164)
          const isActive = activeId === c.id
          return (
            <li key={c.id}>
              <Link
                href={`/whatsapp/${c.id}`}
                prefetch={false}
                className={cn(
                  'flex items-start gap-3 px-3 py-3 hover:bg-fm-surface-container-low transition',
                  isActive && 'bg-fm-surface-container',
                )}
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-fm-primary/10 text-fm-primary flex items-center justify-center font-medium">
                  {title.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-fm-on-surface truncate">{title}</span>
                    <span className="text-[10px] text-fm-on-surface-variant whitespace-nowrap">
                      {formatRelative(c.last_message_at ?? c.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-fm-on-surface-variant truncate">
                    {!c.client_id && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-orange-100 text-orange-700">
                        sin cliente
                      </span>
                    )}
                    {c.bot_paused && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-700">
                        bot pausado
                      </span>
                    )}
                    <span className="truncate">{c.last_message_preview ?? formatPhone(c.phone_e164)}</span>
                  </div>
                </div>
                {c.unread_count > 0 && (
                  <span className="ml-auto self-center inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-green-600 text-white text-[11px] font-medium">
                    {c.unread_count > 99 ? '99+' : c.unread_count}
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

function formatPhone(p: string): string {
  // +5037777-7777 → muy básico
  return p
}

function formatRelative(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'ahora'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d`
  return d.toLocaleDateString('es-SV', { day: '2-digit', month: 'short' })
}
