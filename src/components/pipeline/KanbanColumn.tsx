import { PHASE_LABELS } from '@/lib/domain/pipeline'
import { PipelineCard } from './PipelineCard'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, ConsumptionPhaseLog } from '@/types/db'

interface KanbanColumnProps {
  phase: Phase
  items: PipelineItem[]
  logsMap: Record<string, ConsumptionPhaseLog[]>
  currentUserId: string
}

export function KanbanColumn({ phase, items, logsMap, currentUserId }: KanbanColumnProps) {
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

      <div className="flex-1 bg-[#f5f7f9] rounded-2xl p-2 space-y-2 min-h-[120px]">
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
            />
          ))
        )}
      </div>
    </div>
  )
}
