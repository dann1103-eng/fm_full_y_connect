'use client'

import { useState, useEffect, useTransition, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { adminAddEntry, adminEditEntry, adminDeleteEntry } from '@/app/actions/time'
import {
  ADMIN_CATEGORIES,
  ADMIN_CATEGORY_LABELS,
  formatDuration,
  formatTime,
  formatDayLabel,
  formatDayHeader,
  isoDateStr,
  computeTimeSummary,
} from '@/lib/domain/time'
import { PHASE_LABELS } from '@/lib/domain/pipeline'
import type { TimeEntry, AppUser, AdminCategory, Phase, WorkSession } from '@/types/db'
import { TimeSummaryCards } from './TimeSummaryCards'
import { EditWorkSessionModal } from './EditWorkSessionModal'

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

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

interface Props {
  users: AppUser[]
}

export function AdminTimePanel({ users }: Props) {
  const [selectedUserId, setSelectedUserId] = useState(users[0]?.id ?? '')
  const [mode, setMode] = useState<ViewMode>('day')
  const [day, setDay] = useState<Date>(() => startOfDay(new Date()))
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth())
  const [onlyStandby, setOnlyStandby] = useState(false)
  const [onlyOverlapping, setOnlyOverlapping] = useState(false)
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [workSessions, setWorkSessions] = useState<WorkSession[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null)
  const [editWorkSession, setEditWorkSession] = useState<WorkSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Trigger a refetch desde callbacks (modales add/edit/delete) — usa el
  // mismo state actual del panel.
  const [refetchTick, setRefetchTick] = useState(0)
  function refetch() { setRefetchTick(t => t + 1) }

  useEffect(() => {
    if (!selectedUserId) return
    const { start, end } = computeRange(mode, day, year, month)
    startTransition(async () => {
      const supabase = createClient()
      const [entriesRes, sessionsRes] = await Promise.all([
        supabase
          .from('time_entries')
          .select('*')
          .eq('user_id', selectedUserId)
          .gte('started_at', start)
          .lt('started_at', end)
          .lte('started_at', new Date().toISOString())
          .order('started_at', { ascending: false }),
        supabase
          .from('work_sessions')
          .select('id, user_id, started_at, ended_at, status, notes, breaks_json, total_seconds, productive_seconds, created_at')
          .eq('user_id', selectedUserId)
          .lt('started_at', end)
          .or(`ended_at.gte.${start},ended_at.is.null`),
      ])
      setEntries((entriesRes.data ?? []) as TimeEntry[])
      setWorkSessions((sessionsRes.data ?? []) as WorkSession[])
      setLoading(false)
    })
  }, [selectedUserId, mode, day, year, month, refetchTick])

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

  function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta entrada?')) return
    startTransition(async () => {
      const res = await adminDeleteEntry(id)
      if (res.error) { setError(res.error); return }
      setEntries(prev => prev.filter(e => e.id !== id))
    })
  }

  const summary = useMemo(
    () => computeTimeSummary(entries, workSessions),
    [entries, workSessions],
  )

  // Detecta entradas que se solapan con otra del mismo usuario en el rango.
  // O(n²) sobre las entries cargadas (típicamente <= 50 por día) — fine.
  // Considera entradas activas (ended_at NULL) como extendiéndose hasta now().
  const overlappingIds = useMemo(() => {
    const ids = new Set<string>()
    const nowIso = new Date().toISOString()
    for (let i = 0; i < entries.length; i++) {
      const a = entries[i]
      const aEnd = a.ended_at ?? nowIso
      for (let j = i + 1; j < entries.length; j++) {
        const b = entries[j]
        const bEnd = b.ended_at ?? nowIso
        if (a.started_at < bEnd && b.started_at < aEnd) {
          ids.add(a.id)
          ids.add(b.id)
        }
      }
    }
    return ids
  }, [entries])

  const days = useMemo(() => {
    let visible = entries
    if (onlyStandby) {
      visible = visible.filter((e) => e.entry_type === 'administrative' && e.category === 'standby')
    }
    if (onlyOverlapping) {
      visible = visible.filter((e) => overlappingIds.has(e.id))
    }
    const dayMap = new Map<string, TimeEntry[]>()
    for (const e of visible) {
      const key = isoDateStr(new Date(e.started_at))
      if (!dayMap.has(key)) dayMap.set(key, [])
      dayMap.get(key)!.push(e)
    }
    return [...dayMap.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [entries, onlyStandby, onlyOverlapping, overlappingIds])

  const atMaxDay = day.getTime() >= startOfDay(new Date()).getTime()

  return (
    <div className="space-y-5">
      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-2xl text-sm text-fm-error font-medium">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="glass-panel rounded-[2rem] p-5 flex flex-wrap items-center gap-4">
        <select
          value={selectedUserId}
          onChange={e => setSelectedUserId(e.target.value)}
          className="border border-fm-surface-container-high rounded-xl px-4 py-2 text-sm text-fm-on-surface bg-fm-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
        >
          {users.map(u => (
            <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          {mode === 'day' ? (
            <>
              <button onClick={prevDay} className="p-1.5 rounded-full hover:bg-fm-background text-fm-on-surface-variant">
                <span className="material-symbols-outlined text-lg">chevron_left</span>
              </button>
              <span className="text-sm font-bold text-fm-on-surface w-44 text-center capitalize">{formatDayHeader(day)}</span>
              <button onClick={nextDay} disabled={atMaxDay} className="p-1.5 rounded-full hover:bg-fm-background text-fm-on-surface-variant disabled:opacity-30 disabled:cursor-not-allowed">
                <span className="material-symbols-outlined text-lg">chevron_right</span>
              </button>
            </>
          ) : (
            <>
              <button onClick={prevMonth} className="p-1.5 rounded-full hover:bg-fm-background text-fm-on-surface-variant">
                <span className="material-symbols-outlined text-lg">chevron_left</span>
              </button>
              <span className="text-sm font-bold text-fm-on-surface w-32 text-center">{MONTHS[month]} {year}</span>
              <button onClick={nextMonth} className="p-1.5 rounded-full hover:bg-fm-background text-fm-on-surface-variant">
                <span className="material-symbols-outlined text-lg">chevron_right</span>
              </button>
            </>
          )}
        </div>

        {/* Toggle Día / Mes */}
        <div className="flex rounded-full border border-fm-surface-container-high overflow-hidden text-xs font-bold">
          {(['day', 'month'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 transition-colors ${mode === m ? 'bg-fm-primary text-white' : 'text-fm-on-surface-variant hover:bg-fm-background'}`}
            >
              {m === 'day' ? 'Día' : 'Mes'}
            </button>
          ))}
        </div>

        {/* Toggle solo solapadas — solo aparece si hay overlaps detectados */}
        {overlappingIds.size > 0 && (
          <button
            type="button"
            onClick={() => setOnlyOverlapping(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-full border transition-colors ${
              onlyOverlapping
                ? 'bg-fm-error text-white border-fm-error'
                : 'bg-fm-error/10 text-fm-error border-fm-error/30 hover:bg-fm-error/20'
            }`}
            title={`${overlappingIds.size} entradas con solapamiento detectadas`}
          >
            <span className="material-symbols-outlined text-sm">warning</span>
            Solo solapadas ({overlappingIds.size})
          </button>
        )}

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

        <span className="text-sm text-fm-on-surface-variant">Total: <strong className="text-fm-on-surface">{formatDuration(summary.productiveSeconds)}</strong></span>

        <button
          onClick={() => setShowAdd(true)}
          className="ml-auto flex items-center gap-2 px-4 py-2 bg-fm-primary text-white font-bold rounded-full hover:bg-fm-primary-dim transition-all text-sm"
        >
          <span className="material-symbols-outlined text-base">add</span>
          Agregar entrada
        </button>
      </div>

      {/* Tarjetas resumen */}
      {selectedUserId && <TimeSummaryCards summary={summary} />}

      {/* Jornadas del período */}
      {!loading && workSessions.length > 0 && (
        <div className="glass-panel rounded-[2rem] p-6 space-y-3">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-fm-on-surface-variant">
            Jornadas
          </p>
          {workSessions.map((ws) => {
            const totalSec = ws.total_seconds ?? 0
            const hh = Math.floor(totalSec / 3600)
            const mm = Math.floor((totalSec % 3600) / 60)
            const isActive = ws.status !== 'ended'
            return (
              <div
                key={ws.id}
                className="flex items-center gap-3 rounded-xl bg-fm-surface-container-low border border-fm-outline-variant/20 px-4 py-2.5"
              >
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? 'bg-fm-primary animate-pulse' : 'bg-fm-outline-variant'}`}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-semibold text-fm-on-surface tabular-nums">
                    {new Date(ws.started_at).toLocaleTimeString('es-SV', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' – '}
                    {ws.ended_at
                      ? new Date(ws.ended_at).toLocaleTimeString('es-SV', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'activa'}
                  </span>
                  <span className="ml-2 text-xs text-fm-on-surface-variant tabular-nums">
                    {hh}h {mm}m
                  </span>
                  {isActive && (
                    <span className="ml-2 text-[10px] font-bold text-fm-primary bg-fm-primary/10 px-2 py-0.5 rounded-full">
                      Activa
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setEditWorkSession(ws)}
                  className="p-1.5 rounded-lg text-fm-on-surface-variant hover:bg-fm-surface-container-high hover:text-fm-on-surface transition-colors"
                  title="Editar jornada"
                >
                  <span className="material-symbols-outlined text-[18px]">edit</span>
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Entries */}
      <div className="glass-panel rounded-[2rem] p-6 space-y-5">
        {loading && <p className="text-sm text-fm-outline-variant py-4 text-center">Cargando…</p>}
        {!loading && days.length === 0 && (
          <p className="text-sm text-fm-outline-variant py-6 text-center">
            Sin registros {mode === 'day' ? 'este día' : 'este mes'}.
          </p>
        )}
        {!loading && days.map(([date, dayEntries]) => (
          <div key={date}>
            <div className="flex items-center gap-3 mb-2">
              <p className="text-xs font-extrabold text-fm-on-surface-variant uppercase tracking-wider capitalize">
                {formatDayLabel(date + 'T12:00:00')}
              </p>
              <div className="flex-1 h-px bg-fm-surface-container-low" />
              <p className="text-xs font-bold text-fm-on-surface">
                {formatDuration(dayEntries.filter(e => e.ended_at).reduce((s, e) => s + (e.duration_seconds ?? 0), 0))}
              </p>
            </div>
            <div className="space-y-1.5">
              {dayEntries.map(e => (
                <AdminEntryRow
                  key={e.id}
                  entry={e}
                  onEdit={() => setEditEntry(e)}
                  onDelete={() => handleDelete(e.id)}
                  disabled={isPending}
                  isOverlapping={overlappingIds.has(e.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <AddEntryModal
          targetUserId={selectedUserId}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); refetch() }}
        />
      )}

      {editEntry && (
        <EditEntryModal
          entry={editEntry}
          onClose={() => setEditEntry(null)}
          onSaved={() => { setEditEntry(null); refetch() }}
        />
      )}

      {editWorkSession && (
        <EditWorkSessionModal
          session={editWorkSession}
          onSaved={() => { setEditWorkSession(null); refetch() }}
          onCancel={() => setEditWorkSession(null)}
        />
      )}
    </div>
  )
}

function AdminEntryRow({ entry, onEdit, onDelete, disabled, isOverlapping = false }: {
  entry: TimeEntry; onEdit: () => void; onDelete: () => void; disabled: boolean; isOverlapping?: boolean
}) {
  const isReq = entry.entry_type === 'requirement'
  const label = isReq
    ? entry.title
    : ADMIN_CATEGORY_LABELS[entry.category as AdminCategory] ?? entry.title
  const isActive = !entry.ended_at
  const phaseLabel = isReq && entry.phase ? PHASE_LABELS[entry.phase as Phase] ?? entry.phase : null
  const secondary = isReq
    ? phaseLabel
    : (entry.title && entry.title !== label ? `Interno FM · ${ADMIN_CATEGORY_LABELS[entry.category as AdminCategory] ?? ''}` : null)

  // Highlight rojo cuando esta entrada se solapa con otra del mismo usuario.
  const baseBg = isActive ? 'bg-fm-primary-container/30' : 'bg-fm-surface-container-low'
  const wrapperClass = isOverlapping
    ? 'border border-fm-error/50 bg-fm-error/5'
    : baseBg

  return (
    <div className={`px-4 py-2.5 rounded-xl transition-colors ${wrapperClass}`}>
      <div className="flex items-center gap-3">
        {isOverlapping && (
          <span
            className="material-symbols-outlined text-fm-error text-base flex-shrink-0"
            title="Esta entrada se solapa con otra del mismo usuario. Editá u eliminá una de las dos."
          >
            warning
          </span>
        )}
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: isReq ? '#00675c' : '#abadaf' }} />
        <p className="text-sm text-fm-on-surface flex-1 truncate">{label}</p>
        <p className="text-xs text-fm-on-surface-variant tabular-nums">
          {formatTime(entry.started_at)} – {entry.ended_at ? formatTime(entry.ended_at) : <span className="text-fm-primary font-bold">activo</span>}
        </p>
        <p className="text-xs font-bold text-fm-on-surface tabular-nums w-14 text-right">
          {entry.duration_seconds ? formatDuration(entry.duration_seconds) : '—'}
        </p>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isReq ? 'bg-fm-primary-container/30 text-fm-primary' : 'bg-fm-surface-container-low text-fm-on-surface-variant'}`}>
          {isReq ? 'REQ' : 'ADM'}
        </span>
        <button onClick={onEdit} disabled={disabled} className="p-1 rounded-lg hover:bg-fm-surface-container-high text-fm-on-surface-variant transition-colors">
          <span className="material-symbols-outlined text-base">edit</span>
        </button>
        <button onClick={onDelete} disabled={disabled} className="p-1 rounded-lg hover:bg-red-100 text-fm-error transition-colors">
          <span className="material-symbols-outlined text-base">delete</span>
        </button>
      </div>
      {secondary && (
        <p className="text-[11px] text-fm-on-surface-variant mt-1 ml-5 pl-0.5 truncate">
          {secondary}
        </p>
      )}
      {entry.notes && (
        <p className="text-xs text-fm-outline mt-1 ml-5 pl-0.5 whitespace-pre-wrap break-words">{entry.notes}</p>
      )}
    </div>
  )
}

function AddEntryModal({ targetUserId, onClose, onSaved }: {
  targetUserId: string; onClose: () => void; onSaved: () => void
}) {
  const [entryType, setEntryType] = useState<'administrative' | 'requirement'>('administrative')
  const [category, setCategory] = useState<AdminCategory>('administrativa')
  const [title, setTitle] = useState('')
  const [startedAt, setStartedAt] = useState('')
  const [endedAt, setEndedAt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    if (!startedAt || !endedAt) { setError('Completa las horas de inicio y fin.'); return }
    setError(null)
    // Convertir datetime-local (hora local sin TZ) a UTC ISO en el browser antes de enviar
    const startUtc = new Date(startedAt).toISOString()
    const endUtc   = new Date(endedAt).toISOString()
    startTransition(async () => {
      const res = await adminAddEntry({
        targetUserId,
        entryType,
        category: entryType === 'administrative' ? category : undefined,
        title: entryType === 'administrative' ? ADMIN_CATEGORY_LABELS[category] : title,
        startedAt: startUtc,
        endedAt:   endUtc,
      })
      if (res.error) { setError(res.error); return }
      onSaved()
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-fm-surface-container-lowest rounded-[2rem] p-8 w-full max-w-md space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-fm-on-surface">Agregar entrada</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-fm-background text-fm-on-surface-variant">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">Tipo</label>
            <div className="flex gap-3 mt-1.5">
              {(['administrative', 'requirement'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setEntryType(t)}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${entryType === t ? 'bg-fm-primary text-white border-fm-primary' : 'border-fm-surface-container-high text-fm-on-surface-variant'}`}
                >
                  {t === 'administrative' ? 'Administrativo' : 'Requerimiento'}
                </button>
              ))}
            </div>
          </div>

          {entryType === 'administrative' ? (
            <div>
              <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">Categoría</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as AdminCategory)}
                className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
              >
                {ADMIN_CATEGORIES.map(c => <option key={c} value={c}>{ADMIN_CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">Título del requerimiento</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Nombre del requerimiento"
                className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">Inicio</label>
              <input
                type="datetime-local"
                value={startedAt}
                onChange={e => setStartedAt(e.target.value)}
                className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">Fin</label>
              <input
                type="datetime-local"
                value={endedAt}
                onChange={e => setEndedAt(e.target.value)}
                className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
              />
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-fm-error font-semibold">{error}</p>}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-fm-surface-container-high rounded-full text-sm font-bold text-fm-on-surface-variant hover:bg-fm-background">
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={isPending} className="flex-1 py-2.5 bg-fm-primary text-white rounded-full text-sm font-bold hover:bg-fm-primary-dim disabled:opacity-60">
            {isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EditEntryModal({ entry, onClose, onSaved }: {
  entry: TimeEntry; onClose: () => void; onSaved: () => void
}) {
  const toLocal = (iso: string) => {
    const d = new Date(iso)
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
    return d.toISOString().slice(0, 16)
  }

  const [category, setCategory] = useState<AdminCategory | null>(entry.category as AdminCategory ?? null)
  const [startedAt, setStartedAt] = useState(toLocal(entry.started_at))
  const [endedAt, setEndedAt] = useState(entry.ended_at ? toLocal(entry.ended_at) : '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    if (!endedAt) { setError('La hora de fin es requerida.'); return }
    setError(null)
    // Convertir datetime-local (hora local sin TZ) a UTC ISO en el browser antes de enviar
    const startUtc = new Date(startedAt).toISOString()
    const endUtc   = new Date(endedAt).toISOString()
    startTransition(async () => {
      const res = await adminEditEntry(entry.id, {
        category,
        startedAt: startUtc,
        endedAt:   endUtc,
      })
      if (res.error) { setError(res.error); return }
      onSaved()
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-fm-surface-container-lowest rounded-[2rem] p-8 w-full max-w-md space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-fm-on-surface">Editar entrada</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-fm-background text-fm-on-surface-variant">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="space-y-4">
          {entry.entry_type === 'administrative' && (
            <div>
              <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">Categoría</label>
              <select
                value={category ?? ''}
                onChange={e => setCategory(e.target.value as AdminCategory)}
                className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
              >
                {ADMIN_CATEGORIES.map(c => <option key={c} value={c}>{ADMIN_CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">Inicio</label>
              <input type="datetime-local" value={startedAt} onChange={e => setStartedAt(e.target.value)}
                className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30" />
            </div>
            <div>
              <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">Fin</label>
              <input type="datetime-local" value={endedAt} onChange={e => setEndedAt(e.target.value)}
                className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30" />
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-fm-error font-semibold">{error}</p>}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-fm-surface-container-high rounded-full text-sm font-bold text-fm-on-surface-variant hover:bg-fm-background">Cancelar</button>
          <button onClick={handleSubmit} disabled={isPending} className="flex-1 py-2.5 bg-fm-primary text-white rounded-full text-sm font-bold hover:bg-fm-primary-dim disabled:opacity-60">
            {isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
