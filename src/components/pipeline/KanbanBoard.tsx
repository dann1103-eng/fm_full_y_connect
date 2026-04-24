'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { KanbanColumn } from './KanbanColumn'
import { CardBody } from './PipelineCard'
import { KanbanAccordion } from './KanbanAccordion'
import { MovePhaseModal } from './MovePhaseModal'
import { PhaseSheet } from './PhaseSheet'
import { QuickTimerDialog } from './QuickTimerDialog'
import { createClient } from '@/lib/supabase/client'
import { PHASES } from '@/lib/domain/pipeline'
import { useIsMobile } from '@/lib/hooks/useMediaQuery'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, RequirementPhaseLog } from '@/types/db'

interface PendingMove {
  item: PipelineItem
  fromPhase: Phase
  toPhase: Phase
}

interface KanbanBoardProps {
  byPhase: Record<Phase, PipelineItem[]>
  logsMap: Record<string, RequirementPhaseLog[]>
  currentUserId: string
  canAssign?: boolean
  isAdmin?: boolean
  initialOpenRequirementId?: string | null
}

export function KanbanBoard({
  byPhase,
  logsMap,
  currentUserId,
  canAssign = false,
  isAdmin = false,
  initialOpenRequirementId = null,
}: KanbanBoardProps) {
  const router = useRouter()
  const [activeItem, setActiveItem] = useState<PipelineItem | null>(null)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [activeDetailItem, setActiveDetailItem] = useState<PipelineItem | null>(null)
  const [quickTimerItem, setQuickTimerItem] = useState<PipelineItem | null>(null)
  const [detailLogs, setDetailLogs] = useState<RequirementPhaseLog[]>([])

  function openItemDetail(item: PipelineItem) {
    if (item.content_type === 'reunion' || item.content_type === 'produccion') {
      setQuickTimerItem(item)
    } else {
      setActiveDetailItem(item)
    }
  }
  const [nowMs, setNowMs] = useState<number>(() => new Date().getTime())
  const isMobile = useIsMobile()

  useEffect(() => {
    if (!initialOpenRequirementId) return
    for (const phase of PHASES) {
      const match = byPhase[phase]?.find((it) => it.id === initialOpenRequirementId)
      if (match) {
        openItemDetail(match)
        break
      }
    }
    router.replace('/pipeline')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenRequirementId])

  // Tick every 60s so all cards update their phase-timer color in sync.
  useEffect(() => {
    const id = setInterval(() => setNowMs(new Date().getTime()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!activeDetailItem) return
    const supabase = createClient()
    supabase
      .from('requirement_phase_logs')
      .select('*, moved_by_user:users!moved_by(id, full_name, avatar_url)')
      .eq('requirement_id', activeDetailItem.id)
      .order('created_at')
      .then(({ data }) => {
        setDetailLogs(data ?? [])
      })
  }, [activeDetailItem])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require 5px of movement before activating drag (prevents accidental drags on click)
      activationConstraint: { distance: 5 },
    })
  )

  function onDragStart({ active }: DragStartEvent) {
    const item = active.data.current?.item as PipelineItem | undefined
    if (item) setActiveItem(item)
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveItem(null)

    if (!over || !activeItem) return
    const toPhase = over.id as Phase
    if (toPhase === activeItem.phase) return   // dropped on same column — ignore

    setPendingMove({
      item: activeItem,
      fromPhase: activeItem.phase as Phase,
      toPhase,
    })
  }

  if (isMobile) {
    return (
      <KanbanAccordion
        byPhase={byPhase}
        logsMap={logsMap}
        currentUserId={currentUserId}
        canAssign={canAssign}
        nowMs={nowMs}
        initialOpenRequirementId={initialOpenRequirementId}
      />
    )
  }

  return (
    <>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-4 min-w-max h-full">
          {PHASES.map((phase) => (
            <KanbanColumn
              key={phase}
              phase={phase}
              items={byPhase[phase]}
              logsMap={logsMap}
              currentUserId={currentUserId}
              draggableCards
              onDoubleClick={(item) => openItemDetail(item)}
              nowMs={nowMs}
            />
          ))}
        </div>

        {/* Floating overlay card while dragging.
            We render CardBody directly (not PipelineCard) to avoid registering a
            second useDraggable with the same item.id — which would conflict with the
            original card's registration and may throw a React context error. */}
        <DragOverlay>
          {activeItem ? (
            <div className="rotate-1 scale-105 opacity-90">
              <CardBody item={activeItem} showClient nowMs={nowMs} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Move confirmation modal — outside DndContext to avoid z-index issues */}
      <MovePhaseModal
        open={pendingMove !== null}
        item={pendingMove?.item ?? null}
        fromPhase={pendingMove?.fromPhase ?? null}
        toPhase={pendingMove?.toPhase ?? null}
        currentUserId={currentUserId}
        onClose={() => setPendingMove(null)}
      />

      {/* Detail sheet — opens on double click */}
      {activeDetailItem && (
        <PhaseSheet
          open={true}
          onClose={() => setActiveDetailItem(null)}
          requirementId={activeDetailItem.id}
          contentType={activeDetailItem.content_type}
          currentPhase={activeDetailItem.phase as Phase}
          clientName={activeDetailItem.client_name}
          clientId={activeDetailItem.client_id}
          logs={detailLogs}
          currentUserId={currentUserId}
          title={activeDetailItem.title}
          requirementNotes={activeDetailItem.notes}
          cambiosCount={activeDetailItem.cambios_count}
          reviewStartedAt={activeDetailItem.review_started_at}
          showMoveSection={true}
          priority={activeDetailItem.priority}
          estimatedTimeMinutes={activeDetailItem.estimated_time_minutes}
          assignedTo={activeDetailItem.assigned_to}
          assignees={activeDetailItem.assignees}
          canAssign={canAssign}
          includesStory={activeDetailItem.includes_story}
          deadline={activeDetailItem.deadline}
          isAdmin={isAdmin}
        />
      )}

      {/* Quick timer dialog — for reunion/produccion */}
      {quickTimerItem && (
        <QuickTimerDialog
          open={true}
          onClose={() => setQuickTimerItem(null)}
          requirementId={quickTimerItem.id}
          currentUserId={currentUserId}
          title={quickTimerItem.title}
          notes={quickTimerItem.notes}
          clientName={quickTimerItem.client_name}
          contentType={quickTimerItem.content_type}
          currentPhase={quickTimerItem.phase as Phase}
          assignees={quickTimerItem.assignees}
          startsAt={quickTimerItem.starts_at}
          estimatedTimeMinutes={quickTimerItem.estimated_time_minutes}
        />
      )}
    </>
  )
}
