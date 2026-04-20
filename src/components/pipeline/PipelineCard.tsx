'use client'

import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { PhaseSheet } from './PhaseSheet'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { RequirementPhaseLog, ContentType, Phase, Priority } from '@/types/db'
import { PRIORITY_COLORS } from '@/types/db'
import { UserAvatar } from '@/components/ui/UserAvatar'

const CONTENT_TYPE_COLORS: Record<ContentType, string> = {
  historia:         'bg-purple-100 text-purple-700',
  estatico:         'bg-blue-100 text-blue-700',
  video_corto:      'bg-orange-100 text-orange-700',
  reel:             'bg-pink-100 text-pink-700',
  short:            'bg-yellow-100 text-yellow-700',
  produccion:       'bg-teal-100 text-teal-700',
  reunion:          'bg-indigo-100 text-indigo-700',
  matriz_contenido: 'bg-emerald-100 text-emerald-700',
}

interface PipelineCardProps {
  item: PipelineItem
  logs: RequirementPhaseLog[]
  currentUserId: string
  showClient?: boolean
  draggable?: boolean
  onDoubleClick?: () => void
  canAssign?: boolean
}

/** Exported so KanbanBoard can render it directly inside DragOverlay without
 *  triggering a second useDraggable registration with the same id. */
export function CardBody({
  item,
  showClient,
  dragHandleProps,
  isDragging,
  onClick,
  onDoubleClick,
}: {
  item: PipelineItem
  showClient: boolean
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
  isDragging?: boolean
  onClick?: () => void
  onDoubleClick?: () => void
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
      {/* Top row: client (if shown) + priority dot */}
      <div className="flex items-center justify-between mb-2">
        {showClient ? (
          <div className="flex items-center gap-2 min-w-0">
            {item.client_logo_url ? (
              <img src={item.client_logo_url} alt={item.client_name} className="h-5 w-5 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div className="h-5 w-5 rounded-full bg-[#00675c]/20 flex items-center justify-center flex-shrink-0">
                <span className="text-[8px] font-bold text-[#00675c]">{item.client_name.slice(0, 2).toUpperCase()}</span>
              </div>
            )}
            <span className="text-xs font-medium text-[#2c2f31] truncate">{item.client_name}</span>
          </div>
        ) : <div />}
        {/* Priority dot */}
        <span
          title={item.priority === 'alta' ? 'Alta' : item.priority === 'media' ? 'Media' : 'Baja'}
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ background: PRIORITY_COLORS[item.priority as Priority] }}
        />
      </div>

      <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full mb-2 ${CONTENT_TYPE_COLORS[item.content_type]}`}>
        {CONTENT_TYPE_LABELS[item.content_type]}
      </span>
      {item.carried_over && (
        <span className="inline-block text-xs font-medium px-2 py-0.5 rounded-full mb-2 bg-amber-100 text-amber-700 ml-1">
          Traslado
        </span>
      )}

      {/* Title */}
      {item.title ? (
        <p className="text-sm font-semibold text-[#2c2f31] mb-1 line-clamp-2">{item.title}</p>
      ) : null}

      {/* Notes */}
      {item.notes && (
        <p className="text-xs text-[#595c5e] line-clamp-2 mb-2">{item.notes}</p>
      )}

      {/* Bottom row: date + time chip + assignee */}
      <div className="flex items-center justify-between gap-2 mt-1">
        <p className="text-xs text-[#abadaf]">{relativeDate(item.last_moved_at)}</p>
        <div className="flex items-center gap-1.5">
          {item.estimated_time_minutes != null && (
            <span className="text-[10px] font-semibold text-[#595c5e] bg-[#f5f7f9] px-1.5 py-0.5 rounded-md">
              ⏱ {item.estimated_time_minutes}m
            </span>
          )}
          {item.assignees.length > 0 && (
            <div className="flex items-center">
              {item.assignees.slice(0, 3).map((a, i) => (
                <span
                  key={a.id}
                  title={a.name}
                  className="block"
                  style={{ marginLeft: i === 0 ? 0 : '-6px', zIndex: item.assignees.length - i }}
                >
                  <UserAvatar name={a.name} avatarUrl={a.avatar_url} size="xs" />
                </span>
              ))}
              {item.assignees.length > 3 && (
                <span className="ml-0.5 text-[9px] font-bold text-[#595c5e]">+{item.assignees.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} onDoubleClick={onDoubleClick} className={sharedClassName}>
        {children}
      </button>
    )
  }
  return (
    <div {...dragHandleProps} onDoubleClick={onDoubleClick} className={sharedClassName}>
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
  onDoubleClick,
  canAssign = false,
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
          onDoubleClick={onDoubleClick}
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
        requirementId={item.id}
        contentType={item.content_type}
        currentPhase={item.phase as Phase}
        clientName={item.client_name}
        logs={logs}
        currentUserId={currentUserId}
        title={item.title}
        requirementNotes={item.notes}
        cambiosCount={item.cambios_count}
        reviewStartedAt={item.review_started_at}
        showMoveSection={true}
        priority={item.priority as Priority}
        estimatedTimeMinutes={item.estimated_time_minutes}
        assignedTo={item.assigned_to}
        assignees={item.assignees}
        canAssign={canAssign}
      />
    </>
  )
}
