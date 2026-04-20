'use client'

import { useState, useMemo } from 'react'
import { KanbanBoard } from './KanbanBoard'
import { TableView } from './TableView'
import { PHASES, PHASE_LABELS } from '@/lib/domain/pipeline'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, Priority, RequirementPhaseLog } from '@/types/db'
import { PRIORITY_LABELS } from '@/types/db'

type ViewMode = 'kanban' | 'table'

interface PipelineContainerProps {
  items: PipelineItem[]
  logsMap: Record<string, RequirementPhaseLog[]>
  currentUserId: string
  canAssign: boolean
  clients: { id: string; name: string }[]
}

export function PipelineContainer({ items, logsMap, currentUserId, canAssign, clients }: PipelineContainerProps) {
  const [view, setView] = useState<ViewMode>('kanban')
  const [filterClientId, setFilterClientId] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterPhase, setFilterPhase] = useState('')

  const hasFilters = filterClientId || filterPriority || filterPhase

  const filtered = useMemo(() => {
    return items.filter(item => {
      if (filterClientId && item.client_id !== filterClientId) return false
      if (filterPriority && item.priority !== filterPriority) return false
      if (filterPhase && item.phase !== filterPhase) return false
      return true
    })
  }, [items, filterClientId, filterPriority, filterPhase])

  const byPhase = useMemo(() => {
    const map = Object.fromEntries(PHASES.map(p => [p, [] as PipelineItem[]])) as Record<Phase, PipelineItem[]>
    for (const item of filtered) {
      map[item.phase as Phase]?.push(item)
    }
    return map
  }, [filtered])

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* View switcher */}
        <div className="flex rounded-xl border border-[#dfe3e6] overflow-hidden bg-white text-sm mr-1">
          {(['kanban', 'table'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 font-semibold transition-colors ${
                view === v
                  ? 'bg-[#00675c] text-white'
                  : 'text-[#595c5e] hover:bg-[#f5f7f9]'
              }`}
            >
              {v === 'kanban' ? 'Kanban' : 'Tabla'}
            </button>
          ))}
        </div>

        {/* Client filter */}
        {clients.length > 0 && (
          <select
            value={filterClientId}
            onChange={e => setFilterClientId(e.target.value)}
            className="text-sm border border-[#dfe3e6] rounded-xl px-3 py-1.5 bg-white text-[#2c2f31]"
          >
            <option value="">Todos los clientes</option>
            {clients.map(cl => (
              <option key={cl.id} value={cl.id}>{cl.name}</option>
            ))}
          </select>
        )}

        {/* Priority filter */}
        <select
          value={filterPriority}
          onChange={e => setFilterPriority(e.target.value)}
          className="text-sm border border-[#dfe3e6] rounded-xl px-3 py-1.5 bg-white text-[#2c2f31]"
        >
          <option value="">Todas las prioridades</option>
          {(['alta', 'media', 'baja'] as Priority[]).map(p => (
            <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
          ))}
        </select>

        {/* Phase filter */}
        <select
          value={filterPhase}
          onChange={e => setFilterPhase(e.target.value)}
          className="text-sm border border-[#dfe3e6] rounded-xl px-3 py-1.5 bg-white text-[#2c2f31]"
        >
          <option value="">Todas las fases</option>
          {PHASES.map(p => (
            <option key={p} value={p}>{PHASE_LABELS[p]}</option>
          ))}
        </select>

        {hasFilters && (
          <button
            onClick={() => { setFilterClientId(''); setFilterPriority(''); setFilterPhase('') }}
            className="text-xs text-[#595c5e] hover:text-[#b31b25] px-2.5 py-1.5 rounded-lg border border-[#dfe3e6] transition-colors"
          >
            Limpiar
          </button>
        )}

        <span className="text-xs text-[#abadaf] ml-auto">{filtered.length} pieza{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* View */}
      {view === 'kanban' ? (
        <div className="flex-1 overflow-x-auto">
          <KanbanBoard
            byPhase={byPhase}
            logsMap={logsMap}
            currentUserId={currentUserId}
            canAssign={canAssign}
          />
        </div>
      ) : (
        <TableView
          items={filtered}
          logsMap={logsMap}
          currentUserId={currentUserId}
          canAssign={canAssign}
        />
      )}
    </div>
  )
}
