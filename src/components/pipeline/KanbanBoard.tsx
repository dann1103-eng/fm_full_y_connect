'use client'

import { useState, useEffect } from 'react'
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
import { MovePhaseModal } from './MovePhaseModal'
import { PhaseSheet } from './PhaseSheet'
import { createClient } from '@/lib/supabase/client'
import { PHASES } from '@/lib/domain/pipeline'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, ConsumptionPhaseLog } from '@/types/db'

interface PendingMove {
  item: PipelineItem
  fromPhase: Phase
  toPhase: Phase
}

interface KanbanBoardProps {
  byPhase: Record<Phase, PipelineItem[]>
  logsMap: Record<string, ConsumptionPhaseLog[]>
  currentUserId: string
}

export function KanbanBoard({ byPhase, logsMap, currentUserId }: KanbanBoardProps) {
  const [activeItem, setActiveItem] = useState<PipelineItem | null>(null)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [activeDetailItem, setActiveDetailItem] = useState<PipelineItem | null>(null)
  const [detailLogs, setDetailLogs] = useState<ConsumptionPhaseLog[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)

  useEffect(() => {
    if (!activeDetailItem) { setDetailLogs([]); return }
    setLoadingLogs(true)
    const supabase = createClient()
    supabase
      .from('consumption_phase_logs')
      .select('*')
      .eq('consumption_id', activeDetailItem.id)
      .order('created_at')
      .then(({ data }) => {
        setDetailLogs(data ?? [])
        setLoadingLogs(false)
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
              onDoubleClick={(item) => setActiveDetailItem(item)}
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
              <CardBody item={activeItem} showClient />
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
      {activeDetailItem && !loadingLogs && (
        <PhaseSheet
          open={true}
          onClose={() => setActiveDetailItem(null)}
          consumptionId={activeDetailItem.id}
          contentType={activeDetailItem.content_type}
          currentPhase={activeDetailItem.phase as Phase}
          clientName={activeDetailItem.client_name}
          logs={detailLogs}
          currentUserId={currentUserId}
          title={activeDetailItem.title}
          consumptionNotes={activeDetailItem.notes}
          cambiosCount={activeDetailItem.cambios_count}
          maxCambios={activeDetailItem.max_cambios}
          showMoveSection={false}
        />
      )}
    </>
  )
}
