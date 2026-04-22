'use client'

import { useState } from 'react'
import { PhaseSheet } from './PhaseSheet'
import { PHASE_LABELS, PHASE_CATEGORY } from '@/lib/domain/pipeline'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, Priority, RequirementPhaseLog } from '@/types/db'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '@/types/db'
import { getDeadlineStatus, deadlineChipClasses, formatDeadlineLabel, formatDeadlineDate } from '@/lib/domain/deadline'

type SortField = 'title' | 'client' | 'phase' | 'priority' | 'assignee' | 'time' | 'last_moved' | 'deadline'
type SortDir = 'asc' | 'desc'

const PRIORITY_ORDER: Record<Priority, number> = { alta: 0, media: 1, baja: 2 }
const PHASE_ORDER = [
  'pendiente','proceso_edicion','proceso_diseno','proceso_animacion','cambios',
  'pausa','revision_interna','revision_diseno','revision_cliente',
  'aprobado','pendiente_publicar','publicado_entregado',
]

function sortItems(items: PipelineItem[], field: SortField, dir: SortDir): PipelineItem[] {
  const sorted = [...items].sort((a, b) => {
    let cmp = 0
    switch (field) {
      case 'title':      cmp = (a.title || '').localeCompare(b.title || ''); break
      case 'client':     cmp = a.client_name.localeCompare(b.client_name); break
      case 'phase':      cmp = PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase); break
      case 'priority':   cmp = PRIORITY_ORDER[a.priority as Priority] - PRIORITY_ORDER[b.priority as Priority]; break
      case 'assignee':   cmp = (a.assignees[0]?.name ?? '').localeCompare(b.assignees[0]?.name ?? ''); break
      case 'time':       cmp = (a.estimated_time_minutes ?? 0) - (b.estimated_time_minutes ?? 0); break
      case 'last_moved': cmp = a.last_moved_at.localeCompare(b.last_moved_at); break
      case 'deadline': {
        const ad = a.deadline ?? '9999-12-31'
        const bd = b.deadline ?? '9999-12-31'
        cmp = ad.localeCompare(bd)
        break
      }
    }
    return dir === 'asc' ? cmp : -cmp
  })
  return sorted
}

interface TableViewProps {
  items: PipelineItem[]
  logsMap: Record<string, RequirementPhaseLog[]>
  currentUserId: string
  canAssign: boolean
  isAdmin?: boolean
}

export function TableView({ items, logsMap, currentUserId, canAssign, isAdmin = false }: TableViewProps) {
  const [sortField, setSortField] = useState<SortField>('last_moved')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selectedItem, setSelectedItem] = useState<PipelineItem | null>(null)

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const sorted = sortItems(items, sortField, sortDir)

  const SortIcon = ({ field }: { field: SortField }) => (
    <span className="ml-1 text-fm-outline-variant">
      {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  )

  const th = (field: SortField, label: string, cls = '') => (
    <th
      onClick={() => handleSort(field)}
      className={`px-3 py-2.5 text-left text-[10px] font-bold text-fm-outline uppercase tracking-wider cursor-pointer hover:text-fm-on-surface select-none whitespace-nowrap ${cls}`}
    >
      {label}<SortIcon field={field} />
    </th>
  )

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-fm-on-surface-variant">
        Sin piezas que mostrar.
      </div>
    )
  }

  return (
    <>
      <div className="rounded-2xl border border-fm-surface-container-high overflow-hidden bg-fm-surface-container-lowest">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-fm-background sticky top-0 z-10">
            <tr>
              {th('title',      'Título')}
              {th('client',     'Cliente')}
              {th('phase',      'Fase')}
              {th('deadline',   'Entrega')}
              {th('priority',   'Prioridad')}
              {th('assignee',   'Asignado', 'hidden sm:table-cell')}
              {th('time',       '⏱ Est.',  'hidden md:table-cell')}
              {th('last_moved', 'Movido',   'hidden md:table-cell')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((item) => {
              const phaseCategory = PHASE_CATEGORY[item.phase as Phase]
              const phaseBadgeClass =
                phaseCategory === 'passive_timer' ? 'bg-amber-100 text-amber-700' :
                phaseCategory === 'timestamp_only' ? 'bg-green-100 text-green-700' :
                'bg-fm-background text-fm-on-surface-variant'
              const relDays = Math.floor(
                (Date.now() - new Date(item.last_moved_at).getTime()) / 86400000
              )
              const relLabel = relDays === 0 ? 'hoy' : relDays === 1 ? 'hace 1d' : `hace ${relDays}d`
              const deadlineInfo = getDeadlineStatus(item.deadline, item.phase as Phase)
              const isOverdue = deadlineInfo.status === 'overdue'

              return (
                <tr
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className="border-t border-fm-surface-container-low hover:bg-fm-surface-container-low cursor-pointer transition-colors"
                >
                  {/* Title */}
                  <td className="px-3 py-2.5 max-w-[200px]">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: PRIORITY_COLORS[item.priority as Priority] }}
                      />
                      <span className="font-medium text-fm-on-surface truncate">
                        {item.title || CONTENT_TYPE_LABELS[item.content_type]}
                      </span>
                    </div>
                    <p className="text-[10px] text-fm-outline-variant ml-4 mt-0.5">
                      {CONTENT_TYPE_LABELS[item.content_type]}
                      {item.includes_story && (
                        <span
                          title="Incluye story (suma 1 a historias del ciclo)"
                          className="inline-block ml-1 text-[9px] font-semibold px-1 py-px rounded-full bg-purple-50 text-purple-600 border border-purple-200"
                        >
                          +story
                        </span>
                      )}
                    </p>
                  </td>

                  {/* Client */}
                  <td className="px-3 py-2.5 max-w-[140px]">
                    <div className="flex items-center gap-1.5">
                      {item.client_logo_url ? (
                        <img src={item.client_logo_url} alt="" className="w-4 h-4 rounded-full object-cover" />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-fm-primary/20 flex items-center justify-center">
                          <span className="text-[7px] font-bold text-fm-primary">
                            {item.client_name.slice(0, 1).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <span className="text-fm-on-surface-variant truncate text-xs">{item.client_name}</span>
                    </div>
                  </td>

                  {/* Phase */}
                  <td className="px-3 py-2.5">
                    <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${phaseBadgeClass}`}>
                      {PHASE_LABELS[item.phase as Phase]}
                    </span>
                  </td>

                  {/* Deadline */}
                  <td className="px-3 py-2.5">
                    {deadlineInfo.status === 'none' || !item.deadline ? (
                      <span className="text-xs text-fm-outline-variant">—</span>
                    ) : isOverdue ? (
                      <span
                        className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-fm-error text-white uppercase tracking-wide"
                        title={`Fecha de entrega: ${formatDeadlineDate(item.deadline)}`}
                      >
                        ⚠ Vencido
                      </span>
                    ) : (
                      <span
                        className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap border ${deadlineChipClasses(deadlineInfo.status)}`}
                        title={`Entrega ${formatDeadlineDate(item.deadline)}`}
                      >
                        {formatDeadlineLabel(deadlineInfo.daysLeft ?? 0)}
                      </span>
                    )}
                  </td>

                  {/* Priority */}
                  <td className="px-3 py-2.5">
                    <span
                      className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{
                        color: PRIORITY_COLORS[item.priority as Priority],
                        background: PRIORITY_COLORS[item.priority as Priority] + '20',
                      }}
                    >
                      {PRIORITY_LABELS[item.priority as Priority]}
                    </span>
                  </td>

                  {/* Assignee(s) */}
                  <td className="px-3 py-2.5 hidden sm:table-cell">
                    {item.assignees.length > 0 ? (
                      <div className="flex items-center gap-1.5">
                        <div className="flex items-center">
                          {item.assignees.slice(0, 3).map((a, i) => (
                            <span
                              key={a.id}
                              title={a.name}
                              style={{ marginLeft: i === 0 ? 0 : '-6px', zIndex: item.assignees.length - i, position: 'relative' }}
                              className="w-5 h-5 rounded-full bg-fm-primary/15 flex items-center justify-center text-[9px] font-bold text-fm-primary border border-white overflow-hidden flex-shrink-0"
                            >
                              {a.avatar_url ? (
                                <img src={a.avatar_url} alt={a.name} className="w-full h-full object-cover" />
                              ) : (
                                a.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
                              )}
                            </span>
                          ))}
                        </div>
                        {item.assignees.length === 1 ? (
                          <span className="text-xs text-fm-on-surface-variant truncate max-w-[80px]">{item.assignees[0].name}</span>
                        ) : item.assignees.length > 3 ? (
                          <span className="text-[10px] font-bold text-fm-on-surface-variant">+{item.assignees.length - 3}</span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-fm-outline-variant">—</span>
                    )}
                  </td>

                  {/* Time */}
                  <td className="px-3 py-2.5 hidden md:table-cell text-xs text-fm-on-surface-variant">
                    {item.estimated_time_minutes != null ? `${item.estimated_time_minutes}m` : '—'}
                  </td>

                  {/* Last moved */}
                  <td className="px-3 py-2.5 hidden md:table-cell text-xs text-fm-outline-variant">
                    {relLabel}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selectedItem && (
        <PhaseSheet
          open={true}
          onClose={() => setSelectedItem(null)}
          requirementId={selectedItem.id}
          contentType={selectedItem.content_type}
          currentPhase={selectedItem.phase as Phase}
          clientName={selectedItem.client_name}
          clientId={selectedItem.client_id}
          logs={logsMap[selectedItem.id] ?? []}
          currentUserId={currentUserId}
          title={selectedItem.title}
          requirementNotes={selectedItem.notes}
          cambiosCount={selectedItem.cambios_count}
          reviewStartedAt={selectedItem.review_started_at}
          showMoveSection={true}
          priority={selectedItem.priority as Priority}
          estimatedTimeMinutes={selectedItem.estimated_time_minutes}
          assignedTo={selectedItem.assigned_to}
          assignees={selectedItem.assignees}
          canAssign={canAssign}
          includesStory={selectedItem.includes_story}
          deadline={selectedItem.deadline}
          isAdmin={isAdmin}
        />
      )}
    </>
  )
}
