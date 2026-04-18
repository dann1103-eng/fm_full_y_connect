'use client'

import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { PhaseSheet } from './PhaseSheet'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { ConsumptionPhaseLog, ContentType, Phase } from '@/types/db'

const CONTENT_TYPE_COLORS: Record<ContentType, string> = {
  historia:    'bg-purple-100 text-purple-700',
  estatico:    'bg-blue-100 text-blue-700',
  video_corto: 'bg-orange-100 text-orange-700',
  reel:        'bg-pink-100 text-pink-700',
  short:       'bg-yellow-100 text-yellow-700',
  produccion:  'bg-teal-100 text-teal-700',
  reunion:     'bg-indigo-100 text-indigo-700',
}

interface PipelineCardProps {
  item: PipelineItem
  logs: ConsumptionPhaseLog[]
  currentUserId: string
  /** Si true, muestra el nombre del cliente en la card (vista global) */
  showClient?: boolean
  /** Si true, la card es arrastrable (solo en KanbanBoard del pipeline global) */
  draggable?: boolean
}

/** Exported so KanbanBoard can render it directly inside DragOverlay without
 *  triggering a second useDraggable registration with the same id. */
export function CardBody({
  item,
  showClient,
  dragHandleProps,
  isDragging,
  onClick,
}: {
  item: PipelineItem
  showClient: boolean
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
  isDragging?: boolean
  onClick?: () => void
}) {
  const relativeDate = (iso: string) => {
    const diff = Math.floor((new Date().getTime() - new Date(iso).getTime()) / 86400000)
    if (diff === 0) return 'hoy'
    if (diff === 1) return 'hace 1 día'
    return `hace ${diff} días`
  }

  const sharedClassName = `w-full text-left bg-white rounded-2xl border border-[#dfe3e6] p-3 shadow-sm transition-all
    ${isDragging ? 'opacity-30' : 'hover:shadow-md hover:border-[#00675c]/30'}
    ${dragHandleProps ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
  `

  const children = (
    <>
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
          CONTENT_TYPE_COLORS[item.content_type]
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

      <p className="text-xs text-[#abadaf]">{relativeDate(item.last_moved_at)}</p>
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={sharedClassName}>
        {children}
      </button>
    )
  }
  return (
    <div {...dragHandleProps} className={sharedClassName}>
      {children}
    </div>
  )
}

export function PipelineCard({
  item,
  logs,
  currentUserId,
  showClient = true,
  draggable = false,
}: PipelineCardProps) {
  const [sheetOpen, setSheetOpen] = useState(false)

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: item.id,
    disabled: !draggable,
    data: { item },
  })

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined

  if (draggable) {
    return (
      <div ref={setNodeRef} style={style}>
        <CardBody
          item={item}
          showClient={showClient}
          dragHandleProps={{ ...attributes, ...listeners }}
          isDragging={isDragging}
        />
      </div>
    )
  }

  // Non-draggable: click opens PhaseSheet (existing behaviour)
  return (
    <>
      <CardBody
        item={item}
        showClient={showClient}
        onClick={() => setSheetOpen(true)}
      />
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
