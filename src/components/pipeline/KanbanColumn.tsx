'use client'

import { useDroppable } from '@dnd-kit/core'
import { PHASE_LABELS } from '@/lib/domain/pipeline'
import { PipelineCard } from './PipelineCard'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, ConsumptionPhaseLog } from '@/types/db'

interface KanbanColumnProps {
  phase: Phase
  items: PipelineItem[]
  logsMap: Record<string, ConsumptionPhaseLog[]>
  currentUserId: string
  /** Si true, las cards son arrastrables (solo en KanbanBoard global) */
  draggableCards?: boolean
}

export function KanbanColumn({
  phase,
  items,
  logsMap,
  currentUserId,
  draggableCards = false,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: phase })

  return (
    <div className="flex flex-col min-w-[240px] w-[240px] flex-shrink-0">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[#2c2f31]">{PHASE_LABELS[phase]}</h3>
        {items.length > 0 && (
          <span className="text-xs font-semibold bg-[#f5f7f9] text-[#595c5e] px-2 py-0.5 rounded-full">
            {items.length}
          </span>
        )}
      </div>

      <div
        ref={setNodeRef}
        className={`flex-1 rounded-2xl p-2 space-y-2 min-h-[120px] transition-colors ${
          isOver
            ? 'bg-[#00675c]/8 border-2 border-dashed border-[#00675c]'
            : 'bg-[#f5f7f9]'
        }`}
      >
        {items.length === 0 ? (
          <p className="text-xs text-[#abadaf] text-center py-4">Sin piezas</p>
        ) : (
          items.map((item) => (
            <PipelineCard
              key={item.id}
              item={item}
              logs={logsMap[item.id] ?? []}
              currentUserId={currentUserId}
              showClient
              draggable={draggableCards}
            />
          ))
        )}
      </div>
    </div>
  )
}
