'use client'

import { useState } from 'react'
import { PipelineCard } from './PipelineCard'
import { PHASES, PHASE_LABELS, PHASE_CATEGORY } from '@/lib/domain/pipeline'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, RequirementPhaseLog } from '@/types/db'

interface KanbanAccordionProps {
  byPhase: Record<Phase, PipelineItem[]>
  logsMap: Record<string, RequirementPhaseLog[]>
  currentUserId: string
  canAssign?: boolean
  nowMs?: number
}

export function KanbanAccordion({
  byPhase,
  logsMap,
  currentUserId,
  canAssign = false,
  nowMs,
}: KanbanAccordionProps) {
  const firstNonEmpty = PHASES.find((p) => byPhase[p].length > 0) ?? PHASES[0]
  const [openPhase, setOpenPhase] = useState<Phase | null>(firstNonEmpty)

  return (
    <div className="space-y-2">
      {PHASES.map((phase) => {
        const items = byPhase[phase] ?? []
        const isOpen = openPhase === phase
        const dotColor =
          PHASE_CATEGORY[phase] === 'passive_timer'
            ? '#f59e0b'
            : PHASE_CATEGORY[phase] === 'timestamp_only'
              ? '#22c55e'
              : '#00675c'

        return (
          <div
            key={phase}
            className="bg-white rounded-2xl border border-[#dfe3e6] overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setOpenPhase(isOpen ? null : phase)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#f5f7f9] transition-colors"
              aria-expanded={isOpen}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="material-symbols-outlined text-[#595c5e] text-[18px] transition-transform"
                  style={{ transform: isOpen ? 'rotate(90deg)' : undefined }}
                >
                  chevron_right
                </span>
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: dotColor }}
                />
                <span className="text-sm font-semibold text-[#2c2f31] truncate">
                  {PHASE_LABELS[phase]}
                </span>
              </div>
              <span className="text-xs font-semibold bg-[#f5f7f9] text-[#595c5e] px-2 py-0.5 rounded-full flex-shrink-0">
                {items.length}
              </span>
            </button>

            {isOpen && (
              <div className="px-3 pb-3 pt-1 bg-[#f5f7f9] border-t border-[#dfe3e6] space-y-2">
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
                      draggable={false}
                      canAssign={canAssign}
                      nowMs={nowMs}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
