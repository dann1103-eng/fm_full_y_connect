'use client'

import { useState } from 'react'
import { RequirementHistory } from './RequirementHistory'
import type { Requirement, RequirementCambioLog } from '@/types/db'

const MONTHS_SHORT = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']

function formatCycleLabel(periodStart: string | null | undefined): string {
  if (!periodStart) return ''
  const d = new Date(periodStart)
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

interface Props {
  currentReqs: Requirement[]
  currentCycleId: string
  previousReqs: Requirement[] | null
  previousCycleId: string | null
  previousPeriodStart: string | null
  isAdmin: boolean
  isApprover: boolean
  userMap: Record<string, string>
  cambioLogsMapCurrent: Record<string, RequirementCambioLog[]>
  cambioLogsMapPrevious: Record<string, RequirementCambioLog[]>
}

/**
 * Toggle entre "Ciclo actual" y "Ciclo anterior" para el historial de
 * requerimientos del cliente. Reusa RequirementHistory internamente cambiando
 * los datos según la pestaña seleccionada. Si no hay ciclo previo (cliente
 * nuevo), oculta el botón.
 */
export function CycleHistorySwitcher({
  currentReqs,
  currentCycleId,
  previousReqs,
  previousCycleId,
  previousPeriodStart,
  isAdmin,
  isApprover,
  userMap,
  cambioLogsMapCurrent,
  cambioLogsMapPrevious,
}: Props) {
  const hasPrevious = !!previousCycleId && !!previousReqs
  const [view, setView] = useState<'current' | 'previous'>('current')
  const showingPrevious = view === 'previous' && hasPrevious

  const reqs = showingPrevious ? (previousReqs ?? []) : currentReqs
  const cycleId = showingPrevious ? (previousCycleId ?? currentCycleId) : currentCycleId
  const cambioLogsMap = showingPrevious ? cambioLogsMapPrevious : cambioLogsMapCurrent

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-xl font-extrabold tracking-tight text-fm-on-surface">
          Historial del ciclo
        </h3>
        {hasPrevious && (
          <div className="flex rounded-full border border-fm-surface-container-high overflow-hidden text-xs font-bold">
            <button
              onClick={() => setView('current')}
              className={`px-3 py-1.5 transition-colors ${view === 'current' ? 'bg-fm-primary text-white' : 'text-fm-on-surface-variant hover:bg-fm-background'}`}
            >
              Actual
            </button>
            <button
              onClick={() => setView('previous')}
              className={`px-3 py-1.5 transition-colors ${view === 'previous' ? 'bg-fm-primary text-white' : 'text-fm-on-surface-variant hover:bg-fm-background'}`}
              title={previousPeriodStart ? `Ciclo de ${formatCycleLabel(previousPeriodStart)}` : 'Ciclo anterior'}
            >
              Anterior {previousPeriodStart ? `(${formatCycleLabel(previousPeriodStart)})` : ''}
            </button>
          </div>
        )}
      </div>

      {showingPrevious && reqs.length === 0 && (
        <p className="text-sm text-fm-outline-variant py-4 italic">
          El ciclo anterior no tuvo requerimientos registrados.
        </p>
      )}

      <RequirementHistory
        requirements={reqs}
        isAdmin={isAdmin}
        isApprover={isApprover}
        cycleId={cycleId}
        userMap={userMap}
        cambioLogsMap={cambioLogsMap}
      />
    </div>
  )
}
