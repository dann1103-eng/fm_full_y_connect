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
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 bg-[#e5e9eb] rounded-full h-1.5 overflow-hidden">
        <div
          className="h-full rounded-full bg-[#00675c]"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className="text-xs font-bold text-[#595c5e] tabular-nums w-10 text-right">
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
    return (
      <div className="w-8 h-8 rounded-full bg-[#5bf4de]/30 flex items-center justify-center font-bold text-[#00675c] text-xs flex-shrink-0">
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
    <div className="w-8 h-8 rounded-full bg-[#f5f7f9] flex items-center justify-center flex-shrink-0">
      <span className="material-symbols-outlined text-[#00675c] text-base">task_alt</span>
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
      className={`w-full grid grid-cols-[1fr_auto_180px] items-center gap-4 px-4 py-2 border-b border-[#f0f3f5] text-left ${
        clickable ? 'hover:bg-[#f5f7f9] cursor-pointer' : ''
      }`}
      style={{ paddingLeft: `${depth * 24 + 16}px` }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full bg-[#abadaf] flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm text-[#2c2f31] truncate">{label}</p>
          {entry.notes && entry.notes.trim().length > 0 && (
            <p className="text-xs text-[#595c5e] mt-0.5 line-clamp-2 whitespace-pre-wrap">
              {entry.notes}
            </p>
          )}
          <p className="text-[10px] text-[#abadaf] mt-0.5">
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
      <span className="text-xs font-bold tabular-nums text-[#2c2f31]">
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
        className={`w-full grid grid-cols-[1fr_auto_180px] items-center gap-4 px-4 py-3 border-b border-[#f0f3f5] hover:bg-[#f5f7f9] text-left transition-colors ${
          depth === 0 ? 'bg-white' : 'bg-[#fafbfc]'
        }`}
        style={{ paddingLeft: `${depth * 24 + 16}px` }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {hasChildren && !isRequirementLeaf ? (
            <span className={`material-symbols-outlined text-base text-[#595c5e] transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
              chevron_right
            </span>
          ) : (
            <span className="w-4" />
          )}
          <GroupIcon group={group} />
          <span className={`truncate ${depth === 0 ? 'text-sm font-bold text-[#2c2f31]' : 'text-sm text-[#2c2f31]'}`}>
            {group.label}
          </span>
        </div>
        <span className="text-sm font-bold tabular-nums text-[#2c2f31]">
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

export function TimesheetTree({ groups, totalSeconds, expandedKeys, onToggle, onRequirementClick }: Props) {
  if (groups.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-[#595c5e]">
        Sin entradas de tiempo en el rango seleccionado.
      </div>
    )
  }

  return (
    <div className="border border-[#dfe3e6] rounded-2xl overflow-hidden bg-white">
      <div className="grid grid-cols-[1fr_auto_180px] gap-4 px-4 py-2 border-b border-[#dfe3e6] bg-[#f5f7f9]">
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#595c5e]">Título</span>
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#595c5e]">Duración</span>
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#595c5e]">%</span>
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
      <div className="grid grid-cols-[1fr_auto_180px] gap-4 px-4 py-3 bg-[#f5f7f9] border-t border-[#dfe3e6]">
        <span className="text-sm font-extrabold text-[#2c2f31]">Total</span>
        <span className="text-sm font-extrabold tabular-nums text-[#2c2f31]">
          {formatDurationHMS(totalSeconds)}
        </span>
        <span className="text-sm font-extrabold text-[#2c2f31]">100.0%</span>
      </div>
    </div>
  )
}
