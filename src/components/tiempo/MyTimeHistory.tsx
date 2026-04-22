'use client'

import { useState, useEffect, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ADMIN_CATEGORY_LABELS, formatDuration, formatTime, formatDayLabel, isoDateStr } from '@/lib/domain/time'
import type { TimeEntry, AdminCategory } from '@/types/db'

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

interface DayGroup {
  date: string
  entries: TimeEntry[]
  totalSeconds: number
}

interface Props {
  userId: string
  initialEntries: TimeEntry[]
  initialYear: number
  initialMonth: number
}

export function MyTimeHistory({ userId, initialEntries, initialYear, initialMonth }: Props) {
  const [year, setYear] = useState(initialYear)
  const [month, setMonth] = useState(initialMonth)
  const [entries, setEntries] = useState<TimeEntry[]>(initialEntries)
  const [loading, setLoading] = useState(false)
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (year === initialYear && month === initialMonth) return
    setLoading(true)
    startTransition(async () => {
      const supabase = createClient()
      const start = new Date(year, month, 1).toISOString()
      const end = new Date(year, month + 1, 1).toISOString()
      const { data } = await supabase
        .from('time_entries')
        .select('*')
        .eq('user_id', userId)
        .not('ended_at', 'is', null)
        .gte('started_at', start)
        .lt('started_at', end)
        .order('started_at', { ascending: false })
      setEntries((data ?? []) as TimeEntry[])
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
                <EntryRow key={e.id} entry={e} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function EntryRow({ entry }: { entry: TimeEntry }) {
  const isReq = entry.entry_type === 'requirement'
  const label = isReq
    ? entry.title
    : ADMIN_CATEGORY_LABELS[entry.category as AdminCategory] ?? entry.title

  return (
    <div className="px-4 py-2.5 rounded-xl bg-fm-surface-container-low hover:bg-fm-surface-container-low transition-colors">
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
      {entry.notes && (
        <p className="text-xs text-fm-outline mt-1 ml-5 pl-0.5 truncate">{entry.notes}</p>
      )}
    </div>
  )
}
