'use client'

import { useState } from 'react'
import { ApproveRequestModal, type PendingRequest } from '@/components/requirements/ApproveRequestModal'

interface Item extends PendingRequest {
  created_at: string
}

interface Props {
  items: Item[]
  assignableUsers: { id: string; full_name: string }[]
  isAdmin: boolean
}

export function SolicitudesList({ items, assignableUsers, isAdmin }: Props) {
  const [active, setActive] = useState<Item | null>(null)

  if (items.length === 0) {
    return (
      <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-10 text-center">
        <p className="text-sm text-fm-on-surface-variant">No hay solicitudes pendientes.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {items.map((it) => (
        <div
          key={it.id}
          className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-4 flex items-center justify-between gap-4"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                Pendiente
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wide bg-fm-primary/10 text-fm-primary border border-fm-primary/20 px-1.5 py-0.5 rounded-full">
                {labelForType(it.content_type)}
              </span>
              <span className="text-xs text-fm-on-surface-variant">{it.client_name}</span>
            </div>
            <h3 className="text-base font-semibold text-fm-on-surface mt-1.5 truncate">{it.title}</h3>
            {it.notes && (
              <p className="text-xs text-fm-on-surface-variant mt-0.5 line-clamp-2">{it.notes}</p>
            )}
            <p className="text-xs text-fm-outline mt-1">
              Solicitado por {it.requested_by_name}
              {it.client_requested_deadline && (
                <>
                  {' · Fecha deseada: '}
                  <span className="text-fm-on-surface">
                    {new Date(it.client_requested_deadline).toLocaleString('es-SV', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                </>
              )}
            </p>
          </div>
          <button type="button"
            onClick={() => setActive(it)}
            className="text-sm font-semibold text-white px-4 py-2 rounded-xl"
            style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
          >
            Revisar
          </button>
        </div>
      ))}

      {active && (
        <ApproveRequestModal
          request={active}
          assignableUsers={assignableUsers}
          isAdmin={isAdmin}
          open
          onClose={() => setActive(null)}
        />
      )}
    </div>
  )
}

function labelForType(t: string): string {
  switch (t) {
    case 'reunion': return 'Reunión'
    case 'produccion': return 'Producción'
    case 'historia': return 'Historia'
    case 'estatico': return 'Estático'
    case 'video_corto': return 'Video corto'
    case 'reel': return 'Video largo'
    case 'short': return 'Short'
    default: return t
  }
}
