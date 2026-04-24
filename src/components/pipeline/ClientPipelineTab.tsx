'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { PipelineCard } from './PipelineCard'
import { PHASES, PHASE_LABELS } from '@/lib/domain/pipeline'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, RequirementPhaseLog } from '@/types/db'

interface ClientPipelineTabProps {
  items: PipelineItem[]
  scheduledItems?: PipelineItem[]
  logsMap: Record<string, RequirementPhaseLog[]>
  currentUserId: string
  canAssign?: boolean
  isAdmin?: boolean
}

export function ClientPipelineTab({ items, scheduledItems = [], logsMap, currentUserId, canAssign = false, isAdmin = false }: ClientPipelineTabProps) {
  const [nowMs, setNowMs] = useState<number>(() => new Date().getTime())
  const searchParams = useSearchParams()
  const deepReq = searchParams.get('req')
  const deepTab = searchParams.get('tab')
  const deepPin = searchParams.get('pin')

  useEffect(() => {
    const id = setInterval(() => setNowMs(new Date().getTime()), 60_000)
    return () => clearInterval(id)
  }, [])

  const byPhase = Object.fromEntries(PHASES.map(p => [p, [] as PipelineItem[]])) as Record<Phase, PipelineItem[]>
  for (const item of items) {
    byPhase[item.phase as Phase]?.push(item)
  }

  const nonEmptyPhases = PHASES.filter((p) => byPhase[p].length > 0)

  if (items.length === 0 && scheduledItems.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-fm-on-surface-variant">
        No hay piezas en el pipeline para este ciclo.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {nonEmptyPhases.map((phase) => (
        <div key={phase}>
          <div className="flex items-center gap-2 mb-3">
            <h4 className="text-sm font-semibold text-fm-on-surface">{PHASE_LABELS[phase]}</h4>
            <span className="text-xs font-semibold bg-fm-background text-fm-on-surface-variant px-2 py-0.5 rounded-full">
              {byPhase[phase].length}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {byPhase[phase].map((item) => (
              <PipelineCard
                key={item.id}
                item={item}
                logs={logsMap[item.id] ?? []}
                currentUserId={currentUserId}
                showClient={false}
                canAssign={canAssign}
                isAdmin={isAdmin}
                nowMs={nowMs}
                initialOpen={deepReq === item.id}
                initialReviewOpen={deepReq === item.id && deepTab === 'revision'}
                initialReviewPinId={deepReq === item.id ? deepPin : null}
              />
            ))}
          </div>
        </div>
      ))}

      {scheduledItems.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h4 className="text-sm font-semibold text-fm-on-surface">Reuniones y Producciones</h4>
            <span className="text-xs font-semibold bg-fm-background text-fm-on-surface-variant px-2 py-0.5 rounded-full">
              {scheduledItems.length}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {scheduledItems.map((item) => (
              <PipelineCard
                key={item.id}
                item={item}
                logs={logsMap[item.id] ?? []}
                currentUserId={currentUserId}
                showClient={false}
                canAssign={canAssign}
                isAdmin={isAdmin}
                nowMs={nowMs}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
