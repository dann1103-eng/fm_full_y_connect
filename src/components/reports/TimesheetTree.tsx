'use client'

import { formatDurationHMS } from '@/lib/domain/time'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { ADMIN_CATEGORY_LABELS } from '@/lib/domain/time'
import { PHASE_LABELS } from '@/lib/domain/pipeline'
import type { TimesheetEntry, TimesheetGroup } from '@/lib/domain/timesheet'
import type { Phase } from '@/types/db'

interface Props {
  groups: TimesheetGroup[]
  totalSeconds: number
  expandedKeys: Set<string>
  onToggle: (key: string) => void
  onRequirementClick: (reqId: string) => void
  /** Grupo "Interno FM" separado del árbol principal (solo aplica cuando primary=client) */
  internalGroup?: TimesheetGroup | null
  internalTotalSeconds?: number
}

function fmtEntryWhen(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('es-SV', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function isGroupArray(c: TimesheetGroup['children']): c is TimesheetGroup[] {
  return c.length > 0 && typeof (c[0] as TimesheetGroup).percentage === 'number' && Array.isArray((c[0] as TimesheetGroup).children)
}

function Progress({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2 min-w-[60px] sm:min-w-[140px]">
      <div className="flex-1 bg-fm-surface-container rounded-full h-1.5 overflow-hidden">
        <div
          className="h-full rounded-full bg-fm-primary"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="hidden sm:inline text-xs font-bold text-fm-on-surface-variant tabular-nums w-10 text-right">
        {pct.toFixed(1)}%
      </span>
    </div>
  )
}

function GroupIcon({ group }: { group: TimesheetGroup }) {
  const kind = group.meta?.kind
  if (kind === 'member') {
    return <UserAvatar name={group.label} avatarUrl={group.meta?.avatar_url ?? null} size="sm" />
  }
  if (kind === 'client') {
    if (group.meta?.avatar_url) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={group.meta.avatar_url}
          alt={group.label}
          className="w-8 h-8 rounded-full object-cover flex-shrink-0 border border-fm-surface-container-high"
        />
      )
    }
    return (
      <div className="w-8 h-8 rounded-full bg-fm-primary-container/30 flex items-center justify-center font-bold text-fm-primary text-xs flex-shrink-0">
        {group.label.slice(0, 2).toUpperCase()}
      </div>
    )
  }
  if (kind === 'admin_category') {
    return (
      <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
        <span className="material-symbols-outlined text-amber-600 text-base">event_note</span>
      </div>
    )
  }
  return (
    <div className="w-8 h-8 rounded-full bg-fm-background flex items-center justify-center flex-shrink-0">
      <span className="material-symbols-outlined text-fm-primary text-base">task_alt</span>
    </div>
  )
}

function EntryRow({
  entry,
  depth,
  onRequirementClick,
}: {
  entry: TimesheetEntry
  depth: number
  onRequirementClick: (id: string) => void
}) {
  const clickable = entry.entry_type === 'requirement' && entry.requirement_id
  const label = entry.entry_type === 'administrative'
    ? (entry.category ? ADMIN_CATEGORY_LABELS[entry.category] : 'Administrativo')
    : (entry.requirement_title || entry.title || '— Sin título —')

  const Tag = clickable ? 'button' : 'div'

  return (
    <Tag
      type={clickable ? 'button' : undefined}
      onClick={clickable ? () => onRequirementClick(entry.requirement_id!) : undefined}
      className={`w-full grid grid-cols-[1fr_auto_72px] sm:grid-cols-[1fr_auto_180px] items-center gap-4 px-4 py-2 border-b border-fm-surface-container-low text-left ${
        clickable ? 'hover:bg-fm-background cursor-pointer' : ''
      }`}
      style={{ paddingLeft: `${depth * 24 + 16}px` }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <UserAvatar
          name={entry.user_name}
          avatarUrl={entry.user_avatar_url}
          size="xs"
        />
        <div className="min-w-0">
          <p className="text-sm text-fm-on-surface truncate">{label}</p>
          {entry.notes && entry.notes.trim().length > 0 && (
            <p className="text-xs text-fm-on-surface-variant mt-0.5 line-clamp-2 whitespace-pre-wrap">
              {entry.notes}
            </p>
          )}
          <p className="text-[10px] text-fm-outline-variant mt-0.5">
            {fmtEntryWhen(entry.started_at)}
            {entry.entry_type === 'administrative'
              ? <> · Interno FM</>
              : entry.client_name && <> · {entry.client_name}</>}
            {entry.phase && entry.entry_type === 'requirement' && (
              <> · {PHASE_LABELS[entry.phase as Phase] ?? entry.phase}</>
            )}
          </p>
        </div>
      </div>
      <span className="text-xs font-bold tabular-nums text-fm-on-surface">
        {formatDurationHMS(entry.duration_seconds)}
      </span>
      <span />
    </Tag>
  )
}

function GroupNode({
  group,
  depth,
  expandedKeys,
  onToggle,
  onRequirementClick,
}: {
  group: TimesheetGroup
  depth: number
  expandedKeys: Set<string>
  onToggle: (key: string) => void
  onRequirementClick: (id: string) => void
}) {
  const isExpanded = expandedKeys.has(group.key)
  const hasChildren = group.children.length > 0
  const isGroup = isGroupArray(group.children)

  const isRequirementLeaf =
    group.meta?.kind === 'requirement' && group.meta?.requirement_id && !isGroup

  function handleGroupClick() {
    if (isRequirementLeaf && group.meta?.requirement_id) {
      onRequirementClick(group.meta.requirement_id)
      return
    }
    if (hasChildren) onToggle(group.key)
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleGroupClick}
        aria-expanded={isExpanded}
        className={`w-full grid grid-cols-[1fr_auto_72px] sm:grid-cols-[1fr_auto_180px] items-center gap-4 px-4 py-3 border-b border-fm-surface-container-low hover:bg-fm-background text-left transition-colors ${
          depth === 0 ? 'bg-fm-surface-container-lowest' : 'bg-fm-surface-container-low'
        }`}
        style={{ paddingLeft: `${depth * 24 + 16}px` }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {hasChildren && !isRequirementLeaf ? (
            <span className={`material-symbols-outlined text-base text-fm-on-surface-variant transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
              chevron_right
            </span>
          ) : (
            <span className="w-4" />
          )}
          <GroupIcon group={group} />
          <span className={`truncate ${depth === 0 ? 'text-sm font-bold text-fm-on-surface' : 'text-sm text-fm-on-surface'}`}>
            {group.label}
          </span>
          {hasChildren && !isRequirementLeaf && (
            <span
              title={`${group.children.length} ${group.children.length === 1 ? 'elemento' : 'elementos'}`}
              className="ml-1 inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full bg-fm-background text-[10px] font-bold text-fm-on-surface-variant border border-fm-surface-container-high flex-shrink-0"
            >
              {group.children.length}
            </span>
          )}
        </div>
        <span className="text-sm font-bold tabular-nums text-fm-on-surface">
          {formatDurationHMS(group.durationSeconds)}
        </span>
        <Progress pct={group.percentage} />
      </button>

      {isExpanded && hasChildren && (
        <div>
          {isGroup
            ? (group.children as TimesheetGroup[]).map((child) => (
                <GroupNode
                  key={child.key}
                  group={child}
                  depth={depth + 1}
                  expandedKeys={expandedKeys}
                  onToggle={onToggle}
                  onRequirementClick={onRequirementClick}
                />
              ))
            : (group.children as TimesheetEntry[]).map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  depth={depth + 1}
                  onRequirementClick={onRequirementClick}
                />
              ))}
        </div>
      )}
    </div>
  )
}

export function TimesheetTree({ groups, totalSeconds, expandedKeys, onToggle, onRequirementClick, internalGroup, internalTotalSeconds }: Props) {
  if (groups.length === 0 && !internalGroup) {
    return (
      <div className="p-8 text-center text-sm text-fm-on-surface-variant">
        Sin entradas de tiempo en el rango seleccionado.
      </div>
    )
  }

  const grandTotal = totalSeconds + (internalGroup?.durationSeconds ?? 0)
  const internalPct = grandTotal > 0 ? ((internalGroup?.durationSeconds ?? 0) / grandTotal) * 100 : 0

  return (
    <div className="space-y-4">
      {/* ── Árbol de clientes reales ── */}
      {groups.length > 0 && (
        <div className="border border-fm-surface-container-high rounded-2xl overflow-hidden bg-fm-surface-container-lowest">
          <div className="grid grid-cols-[1fr_auto_72px] sm:grid-cols-[1fr_auto_180px] gap-4 px-4 py-2 border-b border-fm-surface-container-high bg-fm-background">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-fm-on-surface-variant">
              {internalGroup ? 'Clientes' : 'Título'}
            </span>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-fm-on-surface-variant">Duración</span>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-fm-on-surface-variant">
              {internalGroup ? '% sobre clientes' : '%'}
            </span>
          </div>
          {groups.map((g) => (
            <GroupNode
              key={g.key}
              group={g}
              depth={0}
              expandedKeys={expandedKeys}
              onToggle={onToggle}
              onRequirementClick={onRequirementClick}
            />
          ))}
          <div className="grid grid-cols-[1fr_auto_72px] sm:grid-cols-[1fr_auto_180px] gap-4 px-4 py-3 bg-fm-background border-t border-fm-surface-container-high">
            <span className="text-sm font-extrabold text-fm-on-surface">
              {internalGroup ? 'Subtotal clientes' : 'Total'}
            </span>
            <span className="text-sm font-extrabold tabular-nums text-fm-on-surface">
              {formatDurationHMS(internalTotalSeconds ?? totalSeconds)}
            </span>
            <span className="text-sm font-extrabold text-fm-on-surface">100.0%</span>
          </div>
        </div>
      )}

      {/* ── Sección Interno FM separada ── */}
      {internalGroup && (
        <div className="border border-fm-surface-container-high rounded-2xl overflow-hidden bg-fm-surface-container-lowest opacity-80">
          <div className="grid grid-cols-[1fr_auto_72px] sm:grid-cols-[1fr_auto_180px] gap-4 px-4 py-2 border-b border-fm-surface-container-high bg-fm-background">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-fm-outline-variant text-sm">home_work</span>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-fm-outline-variant">
                Tiempo Interno FM
              </span>
            </div>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-fm-outline-variant">Duración</span>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-fm-outline-variant">% del total</span>
          </div>
          <GroupNode
            group={internalGroup}
            depth={0}
            expandedKeys={expandedKeys}
            onToggle={onToggle}
            onRequirementClick={onRequirementClick}
          />
          <div className="grid grid-cols-[1fr_auto_72px] sm:grid-cols-[1fr_auto_180px] gap-4 px-4 py-3 bg-fm-background border-t border-fm-surface-container-high">
            <span className="text-sm font-extrabold text-fm-outline-variant">Interno FM</span>
            <span className="text-sm font-extrabold tabular-nums text-fm-outline-variant">
              {formatDurationHMS(internalGroup.durationSeconds)}
            </span>
            <span className="text-sm font-extrabold text-fm-outline-variant">{internalPct.toFixed(1)}%</span>
          </div>
        </div>
      )}
    </div>
  )
}
