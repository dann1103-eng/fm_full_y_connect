'use client'

import { useDroppable } from '@dnd-kit/core'
import { PHASE_LABELS, PHASE_CATEGORY } from '@/lib/domain/pipeline'
import { PipelineCard } from './PipelineCard'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, RequirementPhaseLog } from '@/types/db'

interface KanbanColumnProps {
  phase: Phase
  items: PipelineItem[]
  logsMap: Record<string, RequirementPhaseLog[]>
  currentUserId: string
  /** Si true, las cards son arrastrables (solo en KanbanBoard global) */
  draggableCards?: boolean
  onDoubleClick?: (item: PipelineItem) => void
  nowMs?: number
}

export function KanbanColumn({
  phase,
  items,
  logsMap,
  currentUserId,
  draggableCards = false,
  onDoubleClick,
  nowMs,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: phase })

  return (
    <div className="flex flex-col min-w-[240px] w-[240px] flex-shrink-0">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              background: PHASE_CATEGORY[phase] === 'passive_timer' ? '#f59e0b'
                : PHASE_CATEGORY[phase] === 'timestamp_only' ? '#22c55e'
                : '#00675c',
            }}
          />
          <h3 className="text-sm font-semibold text-fm-on-surface">{PHASE_LABELS[phase]}</h3>
        </div>
        {items.length > 0 && (
          <span className="text-xs font-semibold bg-fm-background text-fm-on-surface-variant px-2 py-0.5 rounded-full">
            {items.length}
          </span>
        )}
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 rounded-2xl p-2 space-y-2 min-h-[120px] transition-colors ${
          isOver
            ? 'bg-fm-primary/8 border-2 border-dashed border-fm-primary'
            : 'bg-fm-background'
        }`}
      >
        {items.length === 0 ? (
          <p className="text-xs text-fm-outline-variant text-center py-4">Sin piezas</p>
        ) : (
          items.map((item) => (
            <PipelineCard
              key={item.id}
              item={item}
              logs={logsMap[item.id] ?? []}
              currentUserId={currentUserId}
              showClient
              draggable={draggableCards}
              onDoubleClick={onDoubleClick ? () => onDoubleClick(item) : undefined}
              nowMs={nowMs}
            />
          ))
        )}
      </div>
    </div>
  )
}
