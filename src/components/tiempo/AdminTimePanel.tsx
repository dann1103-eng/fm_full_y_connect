'use client'

import { useState, useEffect, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { adminAddEntry, adminEditEntry, adminDeleteEntry } from '@/app/actions/time'
import { ADMIN_CATEGORIES, ADMIN_CATEGORY_LABELS, formatDuration, formatTime, formatDayLabel, isoDateStr } from '@/lib/domain/time'
import type { TimeEntry, AppUser, AdminCategory } from '@/types/db'

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

interface Props {
  users: AppUser[]
}

export function AdminTimePanel({ users }: Props) {
  const [selectedUserId, setSelectedUserId] = useState(users[0]?.id ?? '')
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth())
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function loadEntries(uid: string, y: number, m: number) {
    setLoading(true)
    const supabase = createClient()
    const start = new Date(y, m, 1).toISOString()
    const end = new Date(y, m + 1, 1).toISOString()
    const { data } = await supabase
      .from('time_entries')
      .select('*')
      .eq('user_id', uid)
      .gte('started_at', start)
      .lt('started_at', end)
      .order('started_at', { ascending: false })
    setEntries((data ?? []) as TimeEntry[])
    setLoading(false)
  }

  useEffect(() => { if (selectedUserId) loadEntries(selectedUserId, year, month) }, [selectedUserId, year, month])

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1)
  }
  function nextMonth() {
    const now = new Date()
    if (year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth())) return
    if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1)
  }

  function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta entrada?')) return
    startTransition(async () => {
      const res = await adminDeleteEntry(id)
      if (res.error) { setError(res.error); return }
      setEntries(prev => prev.filter(e => e.id !== id))
    })
  }

  const monthTotal = entries.filter(e => e.ended_at).reduce((s, e) => s + (e.duration_seconds ?? 0), 0)

  const dayMap = new Map<string, TimeEntry[]>()
  for (const e of entries) {
    const day = isoDateStr(new Date(e.started_at))
    if (!dayMap.has(day)) dayMap.set(day, [])
    dayMap.get(day)!.push(e)
  }
  const days = [...dayMap.entries()].sort((a, b) => b[0].localeCompare(a[0]))

  return (
    <div className="space-y-5">
      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-2xl text-sm text-[#b31b25] font-medium">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="glass-panel rounded-[2rem] p-5 flex flex-wrap items-center gap-4">
        <select
          value={selectedUserId}
          onChange={e => setSelectedUserId(e.target.value)}
          className="border border-[#dfe3e6] rounded-xl px-4 py-2 text-sm text-[#2c2f31] bg-white focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
        >
          {users.map(u => (
            <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1.5 rounded-full hover:bg-[#f5f7f9] text-[#595c5e]">
            <span className="material-symbols-outlined text-lg">chevron_left</span>
          </button>
          <span className="text-sm font-bold text-[#2c2f31] w-32 text-center">{MONTHS[month]} {year}</span>
          <button onClick={nextMonth} className="p-1.5 rounded-full hover:bg-[#f5f7f9] text-[#595c5e]">
            <span className="material-symbols-outlined text-lg">chevron_right</span>
          </button>
        </div>

        <span className="text-sm text-[#595c5e]">Total: <strong className="text-[#2c2f31]">{formatDuration(monthTotal)}</strong></span>

        <button
          onClick={() => setShowAdd(true)}
          className="ml-auto flex items-center gap-2 px-4 py-2 bg-[#00675c] text-white font-bold rounded-full hover:bg-[#005047] transition-all text-sm"
        >
          <span className="material-symbols-outlined text-base">add</span>
          Agregar entrada
        </button>
      </div>

      {/* Entries */}
      <div className="glass-panel rounded-[2rem] p-6 space-y-5">
        {loading && <p className="text-sm text-[#abadaf] py-4 text-center">Cargando…</p>}
        {!loading && days.length === 0 && (
          <p className="text-sm text-[#abadaf] py-6 text-center">Sin registros este mes.</p>
        )}
        {!loading && days.map(([date, dayEntries]) => (
          <div key={date}>
            <div className="flex items-center gap-3 mb-2">
              <p className="text-xs font-extrabold text-[#595c5e] uppercase tracking-wider capitalize">
                {formatDayLabel(date + 'T12:00:00')}
              </p>
              <div className="flex-1 h-px bg-[#f0f3f5]" />
              <p className="text-xs font-bold text-[#2c2f31]">
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
          onSaved={() => { setShowAdd(false); loadEntries(selectedUserId, year, month) }}
        />
      )}

      {editEntry && (
        <EditEntryModal
          entry={editEntry}
          onClose={() => setEditEntry(null)}
          onSaved={() => { setEditEntry(null); loadEntries(selectedUserId, year, month) }}
        />
      )}
    </div>
  )
}

function AdminEntryRow({ entry, onEdit, onDelete, disabled }: {
  entry: TimeEntry; onEdit: () => void; onDelete: () => void; disabled: boolean
}) {
  const isReq = entry.entry_type === 'requirement'
  const label = isReq
    ? entry.title
    : ADMIN_CATEGORY_LABELS[entry.category as AdminCategory] ?? entry.title
  const isActive = !entry.ended_at

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-colors ${isActive ? 'bg-[#e8f5f3]' : 'bg-[#f9fafb] hover:bg-[#f0f3f5]'}`}>
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: isReq ? '#00675c' : '#abadaf' }} />
      <p className="text-sm text-[#2c2f31] flex-1 truncate">{label}</p>
      <p className="text-xs text-[#595c5e] tabular-nums">
        {formatTime(entry.started_at)} – {entry.ended_at ? formatTime(entry.ended_at) : <span className="text-[#00675c] font-bold">activo</span>}
      </p>
      <p className="text-xs font-bold text-[#2c2f31] tabular-nums w-14 text-right">
        {entry.duration_seconds ? formatDuration(entry.duration_seconds) : '—'}
      </p>
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isReq ? 'bg-[#e8f5f3] text-[#00675c]' : 'bg-[#f0f2f4] text-[#595c5e]'}`}>
        {isReq ? 'REQ' : 'ADM'}
      </span>
      <button onClick={onEdit} disabled={disabled} className="p-1 rounded-lg hover:bg-[#dfe3e6] text-[#595c5e] transition-colors">
        <span className="material-symbols-outlined text-base">edit</span>
      </button>
      <button onClick={onDelete} disabled={disabled} className="p-1 rounded-lg hover:bg-red-100 text-[#b31b25] transition-colors">
        <span className="material-symbols-outlined text-base">delete</span>
      </button>
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
    startTransition(async () => {
      const res = await adminAddEntry({
        targetUserId,
        entryType,
        category: entryType === 'administrative' ? category : undefined,
        title: entryType === 'administrative' ? ADMIN_CATEGORY_LABELS[category] : title,
        startedAt,
        endedAt,
      })
      if (res.error) { setError(res.error); return }
      onSaved()
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] p-8 w-full max-w-md space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-[#2c2f31]">Agregar entrada</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-[#f5f7f9] text-[#595c5e]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wide">Tipo</label>
            <div className="flex gap-3 mt-1.5">
              {(['administrative', 'requirement'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setEntryType(t)}
                  className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-all ${entryType === t ? 'bg-[#00675c] text-white border-[#00675c]' : 'border-[#dfe3e6] text-[#595c5e]'}`}
                >
                  {t === 'administrative' ? 'Administrativo' : 'Requerimiento'}
                </button>
              ))}
            </div>
          </div>

          {entryType === 'administrative' ? (
            <div>
              <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wide">Categoría</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value as AdminCategory)}
                className="mt-1.5 w-full border border-[#dfe3e6] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
              >
                {ADMIN_CATEGORIES.map(c => <option key={c} value={c}>{ADMIN_CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wide">Título del requerimiento</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Nombre del requerimiento"
                className="mt-1.5 w-full border border-[#dfe3e6] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wide">Inicio</label>
              <input
                type="datetime-local"
                value={startedAt}
                onChange={e => setStartedAt(e.target.value)}
                className="mt-1.5 w-full border border-[#dfe3e6] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wide">Fin</label>
              <input
                type="datetime-local"
                value={endedAt}
                onChange={e => setEndedAt(e.target.value)}
                className="mt-1.5 w-full border border-[#dfe3e6] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
              />
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-[#b31b25] font-semibold">{error}</p>}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-[#dfe3e6] rounded-full text-sm font-bold text-[#595c5e] hover:bg-[#f5f7f9]">
            Cancelar
          </button>
          <button onClick={handleSubmit} disabled={isPending} className="flex-1 py-2.5 bg-[#00675c] text-white rounded-full text-sm font-bold hover:bg-[#005047] disabled:opacity-60">
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
    startTransition(async () => {
      const res = await adminEditEntry(entry.id, {
        category,
        startedAt,
        endedAt,
      })
      if (res.error) { setError(res.error); return }
      onSaved()
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-[2rem] p-8 w-full max-w-md space-y-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-[#2c2f31]">Editar entrada</h3>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-[#f5f7f9] text-[#595c5e]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="space-y-4">
          {entry.entry_type === 'administrative' && (
            <div>
              <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wide">Categoría</label>
              <select
                value={category ?? ''}
                onChange={e => setCategory(e.target.value as AdminCategory)}
                className="mt-1.5 w-full border border-[#dfe3e6] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
              >
                {ADMIN_CATEGORIES.map(c => <option key={c} value={c}>{ADMIN_CATEGORY_LABELS[c]}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wide">Inicio</label>
              <input type="datetime-local" value={startedAt} onChange={e => setStartedAt(e.target.value)}
                className="mt-1.5 w-full border border-[#dfe3e6] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00675c]/30" />
            </div>
            <div>
              <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wide">Fin</label>
              <input type="datetime-local" value={endedAt} onChange={e => setEndedAt(e.target.value)}
                className="mt-1.5 w-full border border-[#dfe3e6] rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00675c]/30" />
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-[#b31b25] font-semibold">{error}</p>}

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-[#dfe3e6] rounded-full text-sm font-bold text-[#595c5e] hover:bg-[#f5f7f9]">Cancelar</button>
          <button onClick={handleSubmit} disabled={isPending} className="flex-1 py-2.5 bg-[#00675c] text-white rounded-full text-sm font-bold hover:bg-[#005047] disabled:opacity-60">
            {isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
