'use client'

import { useState } from 'react'
import { PhaseSheet } from './PhaseSheet'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { ConsumptionPhaseLog, Phase } from '@/types/db'

const CONTENT_TYPE_COLORS: Record<string, string> = {
  historia: 'bg-purple-100 text-purple-700',
  estatico: 'bg-blue-100 text-blue-700',
  video_corto: 'bg-orange-100 text-orange-700',
  reel: 'bg-pink-100 text-pink-700',
  short: 'bg-yellow-100 text-yellow-700',
}

interface PipelineCardProps {
  item: PipelineItem
  logs: ConsumptionPhaseLog[]
  currentUserId: string
  /** Si true, muestra el nombre del cliente en la card (vista global) */
  showClient?: boolean
}

export function PipelineCard({ item, logs, currentUserId, showClient = true }: PipelineCardProps) {
  const [sheetOpen, setSheetOpen] = useState(false)

  const relativeDate = (iso: string) => {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
    if (diff === 0) return 'hoy'
    if (diff === 1) return 'hace 1 día'
    return `hace ${diff} días`
  }

  return (
    <>
      <button
        onClick={() => setSheetOpen(true)}
        className="w-full text-left bg-white rounded-2xl border border-[#dfe3e6] p-3 shadow-sm hover:shadow-md hover:border-[#00675c]/30 transition-all"
      >
        {showClient && (
          <div className="flex items-center gap-2 mb-2">
            {item.client_logo_url ? (
              <img
                src={item.client_logo_url}
                alt={item.client_name}
                className="h-5 w-5 rounded-full object-cover"
              />
            ) : (
              <div className="h-5 w-5 rounded-full bg-[#00675c]/20 flex items-center justify-center">
                <span className="text-[8px] font-bold text-[#00675c]">
                  {item.client_name.slice(0, 2).toUpperCase()}
                </span>
              </div>
            )}
            <span className="text-xs font-medium text-[#2c2f31] truncate">
              {item.client_name}
            </span>
          </div>
        )}

        <span
          className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full mb-2 ${
            CONTENT_TYPE_COLORS[item.content_type] ?? 'bg-gray-100 text-gray-700'
          }`}
        >
          {CONTENT_TYPE_LABELS[item.content_type]}
        </span>
        {item.carried_over && (
          <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full mb-2 bg-amber-100 text-amber-700 ml-1">
            Traslado
          </span>
        )}

        {item.notes && (
          <p className="text-xs text-[#595c5e] line-clamp-2 mb-2">{item.notes}</p>
        )}

        <p className="text-xs text-[#abadaf]">
          {relativeDate(item.last_moved_at)}
        </p>
      </button>

      <PhaseSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        consumptionId={item.id}
        contentType={item.content_type}
        currentPhase={item.phase as Phase}
        clientName={item.client_name}
        logs={logs}
        currentUserId={currentUserId}
      />
    </>
  )
}
