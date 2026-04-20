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
  const [search, setSearch] = useState('')

  const hasFilters = filterClientId || filterPriority || filterPhase || search.trim()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(item => {
      if (filterClientId && item.client_id !== filterClientId) return false
      if (filterPriority && item.priority !== filterPriority) return false
      if (filterPhase && item.phase !== filterPhase) return false
      if (q) {
        const matches =
          item.title?.toLowerCase().includes(q) ||
          item.client_name?.toLowerCase().includes(q) ||
          item.notes?.toLowerCase().includes(q)
        if (!matches) return false
      }
      return true
    })
  }, [items, filterClientId, filterPriority, filterPhase, search])

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

        {/* Search */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[#abadaf] text-base pointer-events-none">
            search
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar…"
            className="w-52 pl-9 pr-8 py-1.5 text-sm bg-white border border-[#dfe3e6] rounded-xl focus:outline-none focus:border-[#00675c]/50 focus:ring-2 focus:ring-[#5bf4de]/30 text-[#2c2f31] placeholder:text-[#abadaf]"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#abadaf] hover:text-[#595c5e]"
              aria-label="Limpiar búsqueda"
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          )}
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
            onClick={() => { setFilterClientId(''); setFilterPriority(''); setFilterPhase(''); setSearch('') }}
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
        <div className="flex-1 overflow-y-auto">
          <TableView
            items={filtered}
            logsMap={logsMap}
            currentUserId={currentUserId}
            canAssign={canAssign}
          />
        </div>
      )}
    </div>
  )
}
