'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchTimesheetEntries } from '@/app/actions/fetchTimesheet'
import {
  buildTimesheetTree,
  secondaryOptionsFor,
  type EntryTypeFilter,
  type PrimaryGroup,
  type SecondaryGroup,
  type TimesheetEntry,
  type TimesheetGroup,
} from '@/lib/domain/timesheet'
import { formatDurationHMS } from '@/lib/domain/time'
import { DateRangePicker, monthRange, type DateRangeValue } from '@/components/ui/DateRangePicker'
import { CsvDownloadButton } from './CsvDownloadButton'
import { TimesheetTree } from './TimesheetTree'
import { TimesheetPdfDownloadButton } from './TimesheetPdfDownloadButton'
import { PhaseSheet } from '@/components/pipeline/PhaseSheet'
import type {
  Phase,
  Priority,
  ContentType,
  RequirementPhaseLog,
} from '@/types/db'

interface Props {
  users: { id: string; full_name: string; avatar_url: string | null }[]
  clients: { id: string; name: string }[]
  currentUserId: string
}

const PRIMARY_LABELS: Record<PrimaryGroup, string> = {
  member: 'Miembro del equipo',
  client: 'Cliente',
}

const SECONDARY_LABELS: Record<SecondaryGroup, string> = {
  client: 'Cliente',
  member: 'Miembro del equipo',
  requirement: 'Requerimiento',
  entry: 'Entrada de tiempo',
}

const ENTRY_TYPE_LABELS: Record<EntryTypeFilter, string> = {
  all: 'Todas las entradas',
  requirement: 'Solo requerimientos',
  administrative: 'Solo administrativas',
}

interface SheetData {
  requirementId: string
  contentType: ContentType
  currentPhase: Phase
  clientName: string
  logs: RequirementPhaseLog[]
  title: string
  requirementNotes: string | null
  cambiosCount: number
  reviewStartedAt: string | null
  priority: Priority
  estimatedTimeMinutes: number | null
  assignedTo: string[] | null
  assignees: { id: string; name: string; avatar_url: string | null }[]
}

export function TimesheetReport({ users, clients, currentUserId }: Props) {
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => monthRange())
  const [primary, setPrimary] = useState<PrimaryGroup>('member')
  const [secondary, setSecondary] = useState<SecondaryGroup>('client')
  const [entryTypeFilter, setEntryTypeFilter] = useState<EntryTypeFilter>('all')
  const [userFilter, setUserFilter] = useState<string[]>([])
  const [clientFilter, setClientFilter] = useState<string[]>([])
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())

  const [entries, setEntries] = useState<TimesheetEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [sheetData, setSheetData] = useState<SheetData | null>(null)

  // Keep secondary in sync when primary changes
  useEffect(() => {
    const allowed = secondaryOptionsFor(primary)
    if (!allowed.includes(secondary)) setSecondary(allowed[0])
  }, [primary, secondary])

  // Fetch entries when server-affecting filters change
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchTimesheetEntries({
      startIso: dateRange.start,
      endIso: dateRange.end,
      userIds: userFilter.length > 0 ? userFilter : undefined,
      clientIds: clientFilter.length > 0 ? clientFilter : undefined,
      entryType: entryTypeFilter,
    }).then((res) => {
      if (cancelled) return
      if (res.error) {
        setError(res.error)
        setEntries([])
      } else {
        setEntries(res.entries ?? [])
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [dateRange, userFilter, clientFilter, entryTypeFilter])

  // Build tree client-side
  const { groups, totalSeconds } = useMemo(
    () => buildTimesheetTree(entries, primary, secondary),
    [entries, primary, secondary],
  )

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleUserFilter(id: string) {
    setUserFilter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function toggleClientFilter(id: string) {
    setClientFilter((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function clearFilters() {
    setUserFilter([])
    setClientFilter([])
    setEntryTypeFilter('all')
    setExpandedKeys(new Set())
  }

  const handleRequirementClick = useCallback(async (reqId: string) => {
    const supabase = createClient()
    const { data: req, error: reqError } = await supabase
      .from('requirements')
      .select(`
        id, content_type, phase, title, notes, cambios_count,
        review_started_at, priority, estimated_time_minutes, assigned_to,
        billing_cycles ( clients ( name ) )
      `)
      .eq('id', reqId)
      .single()
    if (reqError || !req) {
      console.error('openSheet failed:', reqError)
      return
    }

    const { data: logs } = await supabase
      .from('requirement_phase_logs')
      .select('*')
      .eq('requirement_id', reqId)
      .order('created_at', { ascending: true })

    const assignedIds = (req.assigned_to ?? []) as string[]
    let assigneesList: { id: string; name: string; avatar_url: string | null }[] = []
    if (assignedIds.length > 0) {
      const { data: usersRaw } = await supabase
        .from('users')
        .select('id, full_name, avatar_url')
        .in('id', assignedIds)
      assigneesList = (usersRaw ?? []).map((u) => ({
        id: u.id,
        name: u.full_name,
        avatar_url: u.avatar_url ?? null,
      }))
    }

    const cycle = (req as unknown as { billing_cycles: { clients: { name: string } | null } | null }).billing_cycles
    const clientName = cycle?.clients?.name ?? '—'

    setSheetData({
      requirementId: req.id,
      contentType: req.content_type as ContentType,
      currentPhase: req.phase as Phase,
      clientName,
      logs: (logs ?? []) as RequirementPhaseLog[],
      title: req.title ?? '',
      requirementNotes: req.notes,
      cambiosCount: req.cambios_count,
      reviewStartedAt: req.review_started_at,
      priority: (req.priority as Priority) ?? 'media',
      estimatedTimeMinutes: req.estimated_time_minutes,
      assignedTo: assignedIds,
      assignees: assigneesList,
    })
  }, [])

  const summary = useMemo(() => {
    const memberSet = new Set(entries.map((e) => e.user_id))
    const clientSet = new Set(entries.filter((e) => e.client_id).map((e) => e.client_id as string))
    return {
      count: entries.length,
      members: memberSet.size,
      clients: clientSet.size,
    }
  }, [entries])

  // CSV rows — flatten tree
  const { csvHeaders, csvRows } = useMemo(() => {
    const headers = ['Nivel 1', 'Nivel 2', 'Fecha inicio', 'Usuario', 'Cliente', 'Requerimiento', 'Tipo', 'Categoría', 'Duración', '%']
    const rows: string[][] = []
    for (const g of groups) {
      const lvl1Label = g.label
      if (Array.isArray(g.children) && g.children.length > 0 && 'percentage' in (g.children[0] as TimesheetGroup)) {
        for (const sub of g.children as TimesheetGroup[]) {
          // Each entry under sub-group
          for (const e of sub.children as TimesheetEntry[]) {
            rows.push(rowFor(lvl1Label, sub.label, e, totalSeconds))
          }
        }
      } else {
        for (const e of g.children as TimesheetEntry[]) {
          rows.push(rowFor(lvl1Label, '—', e, totalSeconds))
        }
      }
    }
    return { csvHeaders: headers, csvRows: rows }
  }, [groups, totalSeconds])

  const dateRangeLabel = `${new Date(dateRange.start).toISOString().slice(0,10)}_${new Date(dateRange.end).toISOString().slice(0,10)}`

  const secondaryAllowed = secondaryOptionsFor(primary)

  // Multi-chip: show the filter dropdown that is NOT the primary grouping
  const showUserMulti = primary === 'client'
  const showClientMulti = primary === 'member'

  return (
    <div className="space-y-4">
      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3 relative">
        <DateRangePicker value={dateRange} onChange={setDateRange} />

        <FilterSelect
          label="Agrupar por"
          value={primary}
          onChange={(v) => setPrimary(v as PrimaryGroup)}
          options={[
            { value: 'member', label: PRIMARY_LABELS.member },
            { value: 'client', label: PRIMARY_LABELS.client },
          ]}
        />

        <FilterSelect
          label="Y por"
          value={secondary}
          onChange={(v) => setSecondary(v as SecondaryGroup)}
          options={secondaryAllowed.map((s) => ({ value: s, label: SECONDARY_LABELS[s] }))}
        />

        <FilterSelect
          label="Tipo"
          value={entryTypeFilter}
          onChange={(v) => setEntryTypeFilter(v as EntryTypeFilter)}
          options={[
            { value: 'all', label: ENTRY_TYPE_LABELS.all },
            { value: 'requirement', label: ENTRY_TYPE_LABELS.requirement },
            { value: 'administrative', label: ENTRY_TYPE_LABELS.administrative },
          ]}
        />

        {showUserMulti && (
          <MultiFilterChip
            label="Miembros"
            selected={userFilter}
            options={users.map((u) => ({ id: u.id, label: u.full_name }))}
            onToggle={toggleUserFilter}
            onClear={() => setUserFilter([])}
          />
        )}

        {showClientMulti && (
          <MultiFilterChip
            label="Clientes"
            selected={clientFilter}
            options={clients.map((c) => ({ id: c.id, label: c.name }))}
            onToggle={toggleClientFilter}
            onClear={() => setClientFilter([])}
          />
        )}

        {(userFilter.length > 0 || clientFilter.length > 0 || entryTypeFilter !== 'all') && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs font-bold text-[#b31b25] hover:underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total" value={formatDurationHMS(totalSeconds)} />
        <SummaryCard label="Entradas" value={summary.count.toString()} />
        <SummaryCard label="Miembros" value={summary.members.toString()} />
        <SummaryCard label="Clientes" value={summary.clients.toString()} />
      </div>

      {/* Table */}
      {loading ? (
        <div className="p-8 text-center text-sm text-[#595c5e]">Cargando…</div>
      ) : error ? (
        <div className="p-8 text-center text-sm text-[#b31b25]">{error}</div>
      ) : (
        <TimesheetTree
          groups={groups}
          totalSeconds={totalSeconds}
          expandedKeys={expandedKeys}
          onToggle={toggleExpand}
          onRequirementClick={handleRequirementClick}
        />
      )}

      {/* Export */}
      <div className="flex flex-wrap gap-3 pt-2">
        <CsvDownloadButton
          headers={csvHeaders}
          rows={csvRows}
          filename={`hojas-de-tiempo_${dateRangeLabel}.csv`}
          label="Exportar CSV"
        />
        <TimesheetPdfDownloadButton
          params={{
            start: dateRange.start,
            end: dateRange.end,
            primary,
            secondary,
            entryType: entryTypeFilter,
            userIds: userFilter,
            clientIds: clientFilter,
          }}
        />
      </div>

      {/* PhaseSheet */}
      {sheetData && (
        <PhaseSheet
          open={true}
          onClose={() => setSheetData(null)}
          requirementId={sheetData.requirementId}
          contentType={sheetData.contentType}
          currentPhase={sheetData.currentPhase}
          clientName={sheetData.clientName}
          logs={sheetData.logs}
          currentUserId={currentUserId}
          title={sheetData.title}
          requirementNotes={sheetData.requirementNotes}
          cambiosCount={sheetData.cambiosCount}
          reviewStartedAt={sheetData.reviewStartedAt}
          showMoveSection={false}
          priority={sheetData.priority}
          estimatedTimeMinutes={sheetData.estimatedTimeMinutes}
          assignedTo={sheetData.assignedTo}
          assignees={sheetData.assignees}
          canAssign={false}
        />
      )}
    </div>
  )
}

function rowFor(lvl1: string, lvl2: string, e: TimesheetEntry, totalSeconds: number): string[] {
  const pct = totalSeconds > 0 ? ((e.duration_seconds / totalSeconds) * 100).toFixed(2) : '0'
  const fecha = new Date(e.started_at).toLocaleString('es-SV', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  return [
    lvl1,
    lvl2,
    fecha,
    e.user_name,
    e.client_name ?? '—',
    e.entry_type === 'requirement' ? (e.requirement_title ?? e.title) : '—',
    e.entry_type === 'requirement' ? 'Requerimiento' : 'Administrativa',
    e.category ?? '—',
    formatDurationHMS(e.duration_seconds),
    `${pct}%`,
  ]
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-[#dfe3e6] rounded-2xl p-4">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#595c5e]">{label}</p>
      <p className="text-xl font-black text-[#2c2f31] mt-1 tabular-nums">{value}</p>
    </div>
  )
}

interface FilterSelectProps {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}

function FilterSelect({ label, value, onChange, options }: FilterSelectProps) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#595c5e]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-white border border-[#dfe3e6] rounded-full px-3 py-1.5 text-xs font-bold text-[#2c2f31] focus:outline-none focus:border-[#00675c]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

interface MultiFilterChipProps {
  label: string
  selected: string[]
  options: { id: string; label: string }[]
  onToggle: (id: string) => void
  onClear: () => void
}

function MultiFilterChip({ label, selected, options, onToggle, onClear }: MultiFilterChipProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-full border transition-colors ${
          selected.length > 0 ? 'bg-[#00675c] text-white border-[#00675c]' : 'bg-white text-[#595c5e] border-[#dfe3e6] hover:bg-[#f5f7f9]'
        }`}
      >
        {label}
        {selected.length > 0 && <span className="bg-white/20 px-1.5 rounded-full text-[10px]">{selected.length}</span>}
        <span className="material-symbols-outlined text-sm">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-2 z-20 bg-white border border-[#dfe3e6] rounded-2xl shadow-lg p-2 min-w-[220px] max-h-[320px] overflow-y-auto">
          {options.length === 0 ? (
            <p className="text-xs text-[#abadaf] px-2 py-1">Sin opciones</p>
          ) : (
            <>
              {selected.length > 0 && (
                <button
                  type="button"
                  onClick={() => { onClear(); setOpen(false) }}
                  className="w-full text-left px-2 py-1.5 text-xs font-bold text-[#b31b25] hover:bg-[#f5f7f9] rounded"
                >
                  Limpiar selección
                </button>
              )}
              {options.map((o) => {
                const active = selected.includes(o.id)
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => onToggle(o.id)}
                    className={`w-full text-left px-2 py-1.5 text-xs rounded hover:bg-[#f5f7f9] flex items-center gap-2 ${
                      active ? 'text-[#00675c] font-bold' : 'text-[#2c2f31]'
                    }`}
                  >
                    <span className={`material-symbols-outlined text-sm ${active ? 'text-[#00675c]' : 'text-[#abadaf]'}`}>
                      {active ? 'check_box' : 'check_box_outline_blank'}
                    </span>
                    {o.label}
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}
