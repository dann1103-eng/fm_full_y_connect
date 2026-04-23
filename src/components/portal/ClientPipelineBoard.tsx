'use client'

import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { CLIENT_PHASE_ORDER, CLIENT_PHASE_LABELS } from '@/lib/domain/pipeline'
import type { ClientPhase } from '@/lib/domain/pipeline'

type CardItem = { id: string; title: string; notes: string | null; deadline: string | null }

interface Props {
  groups: Record<ClientPhase, CardItem[]>
}

// Phase accent colors (visual distinction, no semantic meaning for client)
const PHASE_DOT: Record<ClientPhase, string> = {
  diseno:             '#595c5e',
  revision_cliente:   '#5b6af4',
  aprobado:           '#00675c',
  pendiente_publicar: '#e09f12',
  publicado:          '#27ae60',
}

export function ClientPipelineBoard({ groups }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
      {CLIENT_PHASE_ORDER.map((phase) => (
        <div key={phase} className="flex flex-col gap-3">
          {/* Column header */}
          <div className="flex items-center gap-2 pb-2 border-b border-fm-outline-variant">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: PHASE_DOT[phase] }}
            />
            <span className="text-xs font-semibold text-fm-on-surface-variant uppercase tracking-wide">
              {CLIENT_PHASE_LABELS[phase]}
            </span>
            <span className="ml-auto text-xs text-fm-on-surface-variant">
              {groups[phase].length}
            </span>
          </div>

          {/* Cards */}
          {groups[phase].length === 0 ? (
            <p className="text-xs text-fm-on-surface-variant italic py-2">Sin requerimientos</p>
          ) : (
            groups[phase].map((item) => (
              <div
                key={item.id}
                className="glass-panel rounded-lg p-3 flex flex-col gap-1"
              >
                <p className="text-sm font-medium text-fm-on-surface leading-snug line-clamp-2">
                  {item.title || '(Sin título)'}
                </p>
                {item.notes && (
                  <p className="text-xs text-fm-on-surface-variant line-clamp-2">
                    {item.notes}
                  </p>
                )}
                {item.deadline && (
                  <p className="text-xs text-fm-on-surface-variant mt-1">
                    Entrega: {format(parseISO(item.deadline), 'dd MMM yyyy', { locale: es })}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  )
}
