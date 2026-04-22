'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PipelineCard } from './PipelineCard'
import { PhaseSheet } from './PhaseSheet'
import { PHASES, PHASE_LABELS, PHASE_CATEGORY } from '@/lib/domain/pipeline'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, Priority, RequirementPhaseLog } from '@/types/db'

interface KanbanAccordionProps {
  byPhase: Record<Phase, PipelineItem[]>
  logsMap: Record<string, RequirementPhaseLog[]>
  currentUserId: string
  canAssign?: boolean
  isAdmin?: boolean
  nowMs?: number
  initialOpenRequirementId?: string | null
}

export function KanbanAccordion({
  byPhase,
  logsMap,
  currentUserId,
  canAssign = false,
  isAdmin = false,
  nowMs,
  initialOpenRequirementId = null,
}: KanbanAccordionProps) {
  const router = useRouter()
  const firstNonEmpty = PHASES.find((p) => byPhase[p].length > 0) ?? PHASES[0]
  const [openPhase, setOpenPhase] = useState<Phase | null>(firstNonEmpty)
  const [deepLinkItem, setDeepLinkItem] = useState<PipelineItem | null>(null)

  useEffect(() => {
    if (!initialOpenRequirementId) return
    for (const phase of PHASES) {
      const match = byPhase[phase]?.find((it) => it.id === initialOpenRequirementId)
      if (match) {
        setOpenPhase(phase)
        setDeepLinkItem(match)
        break
      }
    }
    router.replace('/pipeline')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenRequirementId])

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
            className="bg-fm-surface-container-lowest rounded-2xl border border-fm-surface-container-high overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setOpenPhase(isOpen ? null : phase)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-fm-background transition-colors"
              aria-expanded={isOpen}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="material-symbols-outlined text-fm-on-surface-variant text-[18px] transition-transform"
                  style={{ transform: isOpen ? 'rotate(90deg)' : undefined }}
                >
                  chevron_right
                </span>
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: dotColor }}
                />
                <span className="text-sm font-semibold text-fm-on-surface truncate">
                  {PHASE_LABELS[phase]}
                </span>
              </div>
              <span className="text-xs font-semibold bg-fm-background text-fm-on-surface-variant px-2 py-0.5 rounded-full flex-shrink-0">
                {items.length}
              </span>
            </button>

            {isOpen && (
              <div className="px-3 pb-3 pt-1 bg-fm-background border-t border-fm-surface-container-high space-y-2">
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
                      draggable={false}
                      canAssign={canAssign}
                      isAdmin={isAdmin}
                      nowMs={nowMs}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )
      })}

      {deepLinkItem && (
        <PhaseSheet
          open={true}
          onClose={() => setDeepLinkItem(null)}
          requirementId={deepLinkItem.id}
          contentType={deepLinkItem.content_type}
          currentPhase={deepLinkItem.phase as Phase}
          clientName={deepLinkItem.client_name}
          clientId={deepLinkItem.client_id}
          logs={logsMap[deepLinkItem.id] ?? []}
          currentUserId={currentUserId}
          title={deepLinkItem.title}
          requirementNotes={deepLinkItem.notes}
          cambiosCount={deepLinkItem.cambios_count}
          reviewStartedAt={deepLinkItem.review_started_at}
          showMoveSection={true}
          priority={deepLinkItem.priority as Priority}
          estimatedTimeMinutes={deepLinkItem.estimated_time_minutes}
          assignedTo={deepLinkItem.assigned_to}
          assignees={deepLinkItem.assignees}
          canAssign={canAssign}
          includesStory={deepLinkItem.includes_story}
          deadline={deepLinkItem.deadline}
          isAdmin={isAdmin}
        />
      )}
    </div>
  )
}
