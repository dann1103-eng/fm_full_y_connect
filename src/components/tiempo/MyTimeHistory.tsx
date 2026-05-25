'use client'

import { useState, useEffect, useTransition, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  ADMIN_CATEGORY_LABELS,
  formatDuration,
  formatTime,
  formatDayLabel,
  formatDayHeader,
  isoDateStr,
  computeTimeSummary,
} from '@/lib/domain/time'
import { PHASE_LABELS } from '@/lib/domain/pipeline'
import type {
  TimeEntry,
  AdminCategory,
  ContentType,
  Phase,
  Priority,
  RequirementPhaseLog,
  WorkSession,
} from '@/types/db'
import { PhaseSheet } from '@/components/pipeline/PhaseSheet'
import { TimeSummaryCards } from './TimeSummaryCards'

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

type ViewMode = 'day' | 'month'

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function computeRange(mode: ViewMode, day: Date, year: number, month: number): { start: string; end: string } {
  if (mode === 'day') {
    const startD = startOfDay(day)
    const endD = new Date(startD)
    endD.setDate(endD.getDate() + 1)
    return { start: startD.toISOString(), end: endD.toISOString() }
  }
  return {
    start: new Date(year, month, 1).toISOString(),
    end: new Date(year, month + 1, 1).toISOString(),
  }
}

export function MyTimeHistory({ userId, initialEntries, initialYear, initialMonth, isAdmin = false }: Props) {
  const [mode, setMode] = useState<ViewMode>('day')
  const [day, setDay] = useState<Date>(() => startOfDay(new Date()))
  const [year, setYear] = useState(initialYear)
  const [month, setMonth] = useState(initialMonth)
  const [onlyStandby, setOnlyStandby] = useState(false)
  const [entries, setEntries] = useState<TimeEntryWithContext[]>(initialEntries as TimeEntryWithContext[])
  const [workSessions, setWorkSessions] = useState<WorkSession[]>([])
  const [loading, setLoading] = useState(true)
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

  // Refetch al cambiar mode/day/year/month — paraleliza time_entries + work_sessions
  // para que las tarjetas resumen tengan datos consistentes.
  useEffect(() => {
    const { start, end } = computeRange(mode, day, year, month)
    startTransition(async () => {
      const supabase = createClient()
      const [entriesRes, sessionsRes] = await Promise.all([
        supabase
          .from('time_entries')
          .select('*, requirement:requirements!requirement_id(id, title, billing_cycles!inner(clients!inner(id, name)))')
          .eq('user_id', userId)
          .not('ended_at', 'is', null)
          .gte('started_at', start)
          .lt('started_at', end)
          .lte('started_at', new Date().toISOString())
          .order('started_at', { ascending: false }),
        supabase
          .from('work_sessions')
          .select('id, user_id, started_at, ended_at, status, notes, breaks_json, total_seconds, productive_seconds, created_at')
          .eq('user_id', userId)
          .lt('started_at', end)
          .or(`ended_at.gte.${start},ended_at.is.null`),
      ])
      setEntries((entriesRes.data ?? []) as unknown as TimeEntryWithContext[])
      setWorkSessions((sessionsRes.data ?? []) as WorkSession[])
      setLoading(false)
    })
  }, [mode, day, year, month, userId])

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1)
  }
  function nextMonth() {
    const now = new Date()
    if (year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth())) return
    if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1)
  }
  function prevDay() {
    const d = new Date(day); d.setDate(d.getDate() - 1); setDay(startOfDay(d))
  }
  function nextDay() {
    const today = startOfDay(new Date())
    if (day.getTime() >= today.getTime()) return
    const d = new Date(day); d.setDate(d.getDate() + 1); setDay(startOfDay(d))
  }

  // Group by day — aplica filtro de standby si está activo
  const days = useMemo(() => {
    const visible = onlyStandby
      ? entries.filter((e) => e.entry_type === 'administrative' && e.category === 'standby')
      : entries
    const dayMap = new Map<string, DayGroup>()
    for (const e of visible) {
      const dKey = isoDateStr(new Date(e.started_at))
      if (!dayMap.has(dKey)) dayMap.set(dKey, { date: dKey, entries: [], totalSeconds: 0 })
      const g = dayMap.get(dKey)!
      g.entries.push(e)
      g.totalSeconds += e.duration_seconds ?? 0
    }
    return [...dayMap.values()].sort((a, b) => b.date.localeCompare(a.date))
  }, [entries, onlyStandby])

  const summary = useMemo(
    () => computeTimeSummary(entries, workSessions),
    [entries, workSessions],
  )

  const totalSeconds = summary.productiveSeconds
  const reqTotal = useMemo(
    () => entries.filter(e => e.entry_type === 'requirement').reduce((s, e) => s + (e.duration_seconds ?? 0), 0),
    [entries],
  )
  const adminTotal = totalSeconds - reqTotal
  const isToday = mode === 'day' && isoDateStr(day) === isoDateStr(new Date())
  const atMaxDay = day.getTime() >= startOfDay(new Date()).getTime()

  return (
    <>
    <div className="space-y-5">
      {/* Tarjetas resumen */}
      <TimeSummaryCards summary={summary} />

      {/* Selector + totals */}
      <div className="glass-panel rounded-[2rem] p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            {mode === 'day' ? (
              <>
                <button type="button" onClick={prevDay} className="p-1.5 rounded-full hover:bg-fm-background text-fm-on-surface-variant transition-colors">
                  <span className="material-symbols-outlined text-lg">chevron_left</span>
                </button>
                <p className="text-base font-bold text-fm-on-surface w-44 text-center capitalize">{formatDayHeader(day)}</p>
                <button type="button" onClick={nextDay} disabled={atMaxDay} className="p-1.5 rounded-full hover:bg-fm-background text-fm-on-surface-variant transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                  <span className="material-symbols-outlined text-lg">chevron_right</span>
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={prevMonth} className="p-1.5 rounded-full hover:bg-fm-background text-fm-on-surface-variant transition-colors">
                  <span className="material-symbols-outlined text-lg">chevron_left</span>
                </button>
                <p className="text-base font-bold text-fm-on-surface w-36 text-center">{MONTHS[month]} {year}</p>
                <button type="button" onClick={nextMonth} className="p-1.5 rounded-full hover:bg-fm-background text-fm-on-surface-variant transition-colors">
                  <span className="material-symbols-outlined text-lg">chevron_right</span>
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Toggle Día / Mes */}
            <div className="flex rounded-full border border-fm-surface-container-high overflow-hidden text-xs font-bold">
              {(['day', 'month'] as const).map(m => (
                <button type="button"
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1.5 transition-colors ${mode === m ? 'bg-fm-primary text-white' : 'text-fm-on-surface-variant hover:bg-fm-background'}`}
                >
                  {m === 'day' ? 'Día' : 'Mes'}
                </button>
              ))}
            </div>

            {/* Toggle solo standby */}
            <button
              type="button"
              onClick={() => setOnlyStandby(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-full border transition-colors ${
                onlyStandby
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-fm-surface-container-lowest text-fm-on-surface-variant border-fm-surface-container-high hover:bg-fm-background'
              }`}
              title="Mostrar solo entradas administrativas con categoría Standby"
            >
              <span className="material-symbols-outlined text-sm">pause_circle</span>
              Solo standby
            </button>

            <div className="flex items-center gap-3 text-sm">
              <span className="text-fm-on-surface-variant hidden sm:inline">Req: <strong className="text-fm-primary">{formatDuration(reqTotal)}</strong></span>
              <span className="text-fm-on-surface-variant hidden sm:inline">Admin: <strong className="text-fm-outline">{formatDuration(adminTotal)}</strong></span>
            </div>
          </div>
        </div>

        {loading && <p className="text-sm text-fm-outline-variant py-4 text-center">Cargando…</p>}

        {!loading && days.length === 0 && (
          <p className="text-sm text-fm-outline-variant py-6 text-center">
            Sin registros {mode === 'day' ? (isToday ? 'hoy' : 'este día') : 'este mes'}.
          </p>
        )}

        {!loading && days.map(d => (
          <div key={d.date}>
            <div className="flex items-center gap-3 mb-2">
              <p className="text-xs font-extrabold text-fm-on-surface-variant uppercase tracking-wider capitalize">
                {formatDayLabel(d.date + 'T12:00:00')}
              </p>
              <div className="flex-1 h-px bg-fm-surface-container-low" />
              <p className="text-xs font-bold text-fm-on-surface">{formatDuration(d.totalSeconds)}</p>
            </div>
            <div className="space-y-1.5">
              {d.entries.map(e => (
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
    ? (entry.requirement?.title ?? entry.title)
    : ADMIN_CATEGORY_LABELS[entry.category as AdminCategory] ?? entry.title

  const clientName = entry.requirement?.billing_cycles?.clients?.name
  const phaseLabel = isReq && entry.phase ? PHASE_LABELS[entry.phase as Phase] ?? entry.phase : null

  // Línea secundaria: para REQ "[fase] · [cliente]"; para ADM omitida si el
  // título ya es la categoría (evita duplicación con el label de arriba).
  const secondary = isReq
    ? [phaseLabel, clientName].filter(Boolean).join(' · ')
    : (entry.title && entry.title !== label ? `Interno FM · ${ADMIN_CATEGORY_LABELS[entry.category as AdminCategory] ?? ''}` : null)

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
      {secondary && (
        <p className="text-[11px] text-fm-on-surface-variant mt-1 ml-5 pl-0.5 truncate">
          {secondary}
        </p>
      )}
      {entry.notes && (
        <p className="text-xs text-fm-outline mt-1 ml-5 pl-0.5 whitespace-pre-wrap break-words">{entry.notes}</p>
      )}
    </>
  )

  if (isReq && entry.requirement_id) {
    return (
      <button type="button"
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
