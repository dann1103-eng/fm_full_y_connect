'use client'

import { PipelineCard } from './PipelineCard'
import { PHASES, PHASE_LABELS } from '@/lib/domain/pipeline'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, RequirementPhaseLog } from '@/types/db'

interface ClientPipelineTabProps {
  items: PipelineItem[]
  logsMap: Record<string, RequirementPhaseLog[]>
  currentUserId: string
}

export function ClientPipelineTab({ items, logsMap, currentUserId }: ClientPipelineTabProps) {
  const byPhase: Record<Phase, PipelineItem[]> = {
    pendiente: [],
    en_produccion: [],
    revision_interna: [],
    revision_cliente: [],
    aprobado: [],
    publicado: [],
  }
  for (const item of items) {
    byPhase[item.phase as Phase]?.push(item)
  }

  const nonEmptyPhases = PHASES.filter((p) => byPhase[p].length > 0)

  if (items.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-[#595c5e]">
        No hay piezas en el pipeline para este ciclo.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {nonEmptyPhases.map((phase) => (
        <div key={phase}>
          <div className="flex items-center gap-2 mb-3">
            <h4 className="text-sm font-semibold text-[#2c2f31]">{PHASE_LABELS[phase]}</h4>
            <span className="text-xs font-semibold bg-[#f5f7f9] text-[#595c5e] px-2 py-0.5 rounded-full">
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
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
