'use client'

import { useState, useMemo } from 'react'
import { KanbanBoard } from './KanbanBoard'
import { TableView } from './TableView'
import { NewRequirementFromPipeline } from './NewRequirementFromPipeline'
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
  isAdmin: boolean
  clients: { id: string; name: string }[]
  initialOpenRequirementId?: string | null
}

export function PipelineContainer({
  items,
  logsMap,
  currentUserId,
  canAssign,
  isAdmin,
  clients,
  initialOpenRequirementId = null,
}: PipelineContainerProps) {
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
        {/* New requirement button — visible to admin/supervisor */}
        {(isAdmin || canAssign) && clients.length > 0 && (
          <NewRequirementFromPipeline clients={clients} isAdmin={isAdmin} canAssign={canAssign} />
        )}

        {/* View switcher */}
        <div className="flex rounded-xl border border-fm-surface-container-high overflow-hidden bg-fm-surface-container-lowest text-sm mr-1">
          {(['kanban', 'table'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 font-semibold transition-colors ${
                view === v
                  ? 'bg-fm-primary text-white'
                  : 'text-fm-on-surface-variant hover:bg-fm-background'
              }`}
            >
              {v === 'kanban' ? 'Kanban' : 'Tabla'}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-fm-outline-variant text-base pointer-events-none">
            search
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar…"
            className="w-52 pl-9 pr-8 py-1.5 text-sm bg-fm-surface-container-lowest border border-fm-surface-container-high rounded-xl focus:outline-none focus:border-fm-primary/50 focus:ring-2 focus:ring-fm-primary-container/30 text-fm-on-surface placeholder:text-fm-outline-variant"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-fm-outline-variant hover:text-fm-on-surface-variant"
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
            className="text-sm border border-fm-surface-container-high rounded-xl px-3 py-1.5 bg-fm-surface-container-lowest text-fm-on-surface"
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
          className="text-sm border border-fm-surface-container-high rounded-xl px-3 py-1.5 bg-fm-surface-container-lowest text-fm-on-surface"
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
          className="text-sm border border-fm-surface-container-high rounded-xl px-3 py-1.5 bg-fm-surface-container-lowest text-fm-on-surface"
        >
          <option value="">Todas las fases</option>
          {PHASES.map(p => (
            <option key={p} value={p}>{PHASE_LABELS[p]}</option>
          ))}
        </select>

        {hasFilters && (
          <button
            onClick={() => { setFilterClientId(''); setFilterPriority(''); setFilterPhase(''); setSearch('') }}
            className="text-xs text-fm-on-surface-variant hover:text-fm-error px-2.5 py-1.5 rounded-lg border border-fm-surface-container-high transition-colors"
          >
            Limpiar
          </button>
        )}

        <span className="text-xs text-fm-outline-variant ml-auto">{filtered.length} pieza{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* View */}
      {view === 'kanban' ? (
        <div className="flex-1 overflow-auto">
          <KanbanBoard
            byPhase={byPhase}
            logsMap={logsMap}
            currentUserId={currentUserId}
            canAssign={canAssign}
            isAdmin={isAdmin}
            initialOpenRequirementId={initialOpenRequirementId}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <TableView
            items={filtered}
            logsMap={logsMap}
            currentUserId={currentUserId}
            canAssign={canAssign}
            isAdmin={isAdmin}
          />
        </div>
      )}
    </div>
  )
}
