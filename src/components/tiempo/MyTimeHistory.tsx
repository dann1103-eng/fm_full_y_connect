'use client'

import { useState, useEffect, useTransition, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ADMIN_CATEGORY_LABELS, formatDuration, formatTime, formatDayLabel, isoDateStr } from '@/lib/domain/time'
import type { TimeEntry, AdminCategory, ContentType, Phase, Priority, RequirementPhaseLog } from '@/types/db'
import { PhaseSheet } from '@/components/pipeline/PhaseSheet'

type TimeEntryWithContext = TimeEntry & {
  requirement?: {
    id: string
    title: string
    billing_cycles?: {
      clients?: { id: string; name: string } | null
    } | null
  } | null
}

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

interface DayGroup {
  date: string
  entries: TimeEntryWithContext[]
  totalSeconds: number
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
  assignedTo: string[]
  assignees: { id: string; name: string; avatar_url: string | null }[]
}

interface Props {
  userId: string
  initialEntries: TimeEntry[]
  initialYear: number
  initialMonth: number
  isAdmin?: boolean
}

export function MyTimeHistory({ userId, initialEntries, initialYear, initialMonth, isAdmin = false }: Props) {
  const [year, setYear] = useState(initialYear)
  const [month, setMonth] = useState(initialMonth)
  const [entries, setEntries] = useState<TimeEntryWithContext[]>(initialEntries as TimeEntryWithContext[])
  const [loading, setLoading] = useState(false)
  const [, startTransition] = useTransition()
  const [sheetData, setSheetData] = useState<SheetData | null>(null)

  const handleOpenReq = useCallback(async (reqId: string) => {
    const supabase = createClient()
    const { data: req, error } = await supabase
      .from('requirements')
      .select(`
        id, content_type, phase, title, notes, cambios_count,
        review_started_at, priority, estimated_time_minutes, assigned_to,
        billing_cycles ( clients ( name ) )
      `)
      .eq('id', reqId)
      .single()
    if (error || !req) return

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
      assigneesList = (usersRaw ?? []).map(u => ({ id: u.id, name: u.full_name, avatar_url: u.avatar_url ?? null }))
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clientName = (req as any).billing_cycles?.clients?.name ?? '—'

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

  useEffect(() => {
    if (year === initialYear && month === initialMonth) return
    setLoading(true)
    startTransition(async () => {
      const supabase = createClient()
      const start = new Date(year, month, 1).toISOString()
      const end = new Date(year, month + 1, 1).toISOString()
      const { data } = await supabase
        .from('time_entries')
        .select('*, requirement:requirements!requirement_id(id, title, billing_cycles!inner(clients!inner(id, name)))')
        .eq('user_id', userId)
        .not('ended_at', 'is', null)
        .gte('started_at', start)
        .lt('started_at', end)
        .order('started_at', { ascending: false })
      setEntries((data ?? []) as unknown as TimeEntryWithContext[])
      setLoading(false)
    })
  }, [year, month, userId, initialYear, initialMonth])

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1)
  }
  function nextMonth() {
    const now = new Date()
    if (year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth())) return
    if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1)
  }

  // Group by day
  const dayMap = new Map<string, DayGroup>()
  for (const e of entries) {
    const day = isoDateStr(new Date(e.started_at))
    if (!dayMap.has(day)) dayMap.set(day, { date: day, entries: [], totalSeconds: 0 })
    const g = dayMap.get(day)!
    g.entries.push(e)
    g.totalSeconds += e.duration_seconds ?? 0
  }
  const days = [...dayMap.values()].sort((a, b) => b.date.localeCompare(a.date))

  const monthTotal = entries.reduce((s, e) => s + (e.duration_seconds ?? 0), 0)
  const reqTotal = entries.filter(e => e.entry_type === 'requirement').reduce((s, e) => s + (e.duration_seconds ?? 0), 0)
  const adminTotal = entries.filter(e => e.entry_type === 'administrative').reduce((s, e) => s + (e.duration_seconds ?? 0), 0)

  // Today summary
  const todayStr = isoDateStr(new Date())
  const todayEntries = entries.filter(e => isoDateStr(new Date(e.started_at)) === todayStr)
  const todayTotal = todayEntries.reduce((s, e) => s + (e.duration_seconds ?? 0), 0)

  return (
    <>
    <div className="space-y-5">
      {/* Today summary */}
      {todayTotal > 0 && (
        <div className="glass-panel rounded-[2rem] p-6">
          <p className="text-[11px] font-extrabold text-fm-outline-variant uppercase tracking-widest mb-3">Hoy</p>
          <div className="flex gap-6 flex-wrap">
            <div>
              <p className="text-3xl font-black text-fm-on-surface">{formatDuration(todayTotal)}</p>
              <p className="text-xs text-fm-on-surface-variant mt-0.5">Total del día</p>
            </div>
            {reqTotal > 0 && (
              <div className="border-l border-fm-surface-container-high pl-6">
                <p className="text-xl font-bold text-fm-primary">{formatDuration(todayEntries.filter(e => e.entry_type === 'requirement').reduce((s, e) => s + (e.duration_seconds ?? 0), 0))}</p>
                <p className="text-xs text-fm-on-surface-variant mt-0.5">Requerimientos</p>
              </div>
            )}
            {adminTotal > 0 && (
              <div className="border-l border-fm-surface-container-high pl-6">
                <p className="text-xl font-bold text-fm-on-surface-variant">{formatDuration(todayEntries.filter(e => e.entry_type === 'administrative').reduce((s, e) => s + (e.duration_seconds ?? 0), 0))}</p>
                <p className="text-xs text-fm-on-surface-variant mt-0.5">Administrativo</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Month selector + totals */}
      <div className="glass-panel rounded-[2rem] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={prevMonth} className="p-1.5 rounded-full hover:bg-fm-background text-fm-on-surface-variant transition-colors">
              <span className="material-symbols-outlined text-lg">chevron_left</span>
            </button>
            <p className="text-base font-bold text-fm-on-surface w-36 text-center">{MONTHS[month]} {year}</p>
            <button onClick={nextMonth} className="p-1.5 rounded-full hover:bg-fm-background text-fm-on-surface-variant transition-colors">
              <span className="material-symbols-outlined text-lg">chevron_right</span>
            </button>
          </div>
          <div className="flex items-center gap-5 text-sm">
            <span className="text-fm-on-surface-variant">Total: <strong className="text-fm-on-surface">{formatDuration(monthTotal)}</strong></span>
            <span className="text-fm-on-surface-variant">Req: <strong className="text-fm-primary">{formatDuration(reqTotal)}</strong></span>
            <span className="text-fm-on-surface-variant">Admin: <strong className="text-fm-outline">{formatDuration(adminTotal)}</strong></span>
          </div>
        </div>

        {loading && <p className="text-sm text-fm-outline-variant py-4 text-center">Cargando…</p>}

        {!loading && days.length === 0 && (
          <p className="text-sm text-fm-outline-variant py-6 text-center">Sin registros este mes.</p>
        )}

        {!loading && days.map(day => (
          <div key={day.date}>
            <div className="flex items-center gap-3 mb-2">
              <p className="text-xs font-extrabold text-fm-on-surface-variant uppercase tracking-wider capitalize">
                {formatDayLabel(day.date + 'T12:00:00')}
              </p>
              <div className="flex-1 h-px bg-fm-surface-container-low" />
              <p className="text-xs font-bold text-fm-on-surface">{formatDuration(day.totalSeconds)}</p>
            </div>
            <div className="space-y-1.5">
              {day.entries.map(e => (
                <EntryRow key={e.id} entry={e} onOpenReq={handleOpenReq} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>

    {sheetData && (
      <PhaseSheet
        open={true}
        onClose={() => setSheetData(null)}
        requirementId={sheetData.requirementId}
        contentType={sheetData.contentType}
        currentPhase={sheetData.currentPhase}
        clientName={sheetData.clientName}
        logs={sheetData.logs}
        currentUserId={userId}
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
        isAdmin={isAdmin}
      />
    )}
    </>
  )
}

function EntryRow({ entry, onOpenReq }: { entry: TimeEntryWithContext; onOpenReq: (id: string) => void }) {
  const isReq = entry.entry_type === 'requirement'
  const label = isReq
    ? entry.title
    : ADMIN_CATEGORY_LABELS[entry.category as AdminCategory] ?? entry.title

  const clientName = entry.requirement?.billing_cycles?.clients?.name
  const reqTitle = entry.requirement?.title

  const body = (
    <>
      <div className="flex items-center gap-3">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: isReq ? '#00675c' : '#abadaf' }}
        />
        <p className="text-sm text-fm-on-surface flex-1 truncate">{label}</p>
        <p className="text-xs text-fm-on-surface-variant tabular-nums">
          {formatTime(entry.started_at)} – {entry.ended_at ? formatTime(entry.ended_at) : '…'}
        </p>
        <p className="text-xs font-bold text-fm-on-surface tabular-nums w-14 text-right">
          {entry.duration_seconds ? formatDuration(entry.duration_seconds) : '—'}
        </p>
        {isReq ? (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-fm-primary-container/30 text-fm-primary">REQ</span>
        ) : (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-fm-surface-container-low text-fm-on-surface-variant">ADM</span>
        )}
      </div>
      {isReq && clientName && (
        <p className="text-[11px] text-fm-on-surface-variant mt-1 ml-5 pl-0.5 truncate">
          {clientName}{reqTitle ? ` · ${reqTitle}` : ''}
        </p>
      )}
      {entry.notes && (
        <p className="text-xs text-fm-outline mt-1 ml-5 pl-0.5 truncate">{entry.notes}</p>
      )}
    </>
  )

  if (isReq && entry.requirement_id) {
    return (
      <button
        onClick={() => onOpenReq(entry.requirement_id!)}
        className="block w-full text-left px-4 py-2.5 rounded-xl bg-fm-surface-container-low hover:bg-fm-surface-container transition-colors cursor-pointer"
      >
        {body}
      </button>
    )
  }

  return (
    <div className="px-4 py-2.5 rounded-xl bg-fm-surface-container-low transition-colors">
      {body}
    </div>
  )
}
