'use client'

import { useState, useEffect, useTransition } from 'react'
import { startAdminEntry, stopActiveEntry, updateMyActiveNotes } from '@/app/actions/time'
import { ADMIN_CATEGORIES, ADMIN_CATEGORY_LABELS, formatDuration } from '@/lib/domain/time'
import type { AdminCategory, TimeEntry } from '@/types/db'

interface Props {
  initialActive: TimeEntry | null
}

export function ClockInPanel({ initialActive }: Props) {
  const [active, setActive] = useState<TimeEntry | null>(initialActive)
  const [selectedCategory, setSelectedCategory] = useState<AdminCategory>('administrativa')
  const [notes, setNotes] = useState('')
  const [editingNotes, setEditingNotes] = useState(false)
  const [activeNotesDraft, setActiveNotesDraft] = useState(initialActive?.notes ?? '')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Live elapsed counter
  useEffect(() => {
    if (!active) { setElapsed(0); return }
    const calc = () => {
      const diff = Math.round((Date.now() - new Date(active.started_at).getTime()) / 1000)
      setElapsed(diff)
    }
    calc()
    const id = setInterval(calc, 1000)
    return () => clearInterval(id)
  }, [active])

  function handleStart() {
    setError(null)
    startTransition(async () => {
      const res = await startAdminEntry(selectedCategory, notes)
      if (res.error) { setError(res.error); return }
      setActive({
        id: 'pending',
        user_id: '',
        entry_type: 'administrative',
        category: selectedCategory,
        phase: 'administrative',
        title: selectedCategory,
        started_at: new Date().toISOString(),
        ended_at: null,
        duration_seconds: null,
        notes: notes.trim() || null,
        created_at: new Date().toISOString(),
        requirement_id: null,
        scheduled_at: null,
        scheduled_duration_minutes: null,
        scheduled_attendees: [],
      })
      setActiveNotesDraft(notes.trim())
      setNotes('')
    })
  }

  function handleSaveActiveNotes() {
    startTransition(async () => {
      await updateMyActiveNotes(activeNotesDraft)
      setEditingNotes(false)
    })
  }

  function handleStop() {
    setError(null)
    startTransition(async () => {
      const res = await stopActiveEntry()
      if (res.error) { setError(res.error); return }
      setActive(null)
    })
  }

  const activeLabel = active?.category
    ? ADMIN_CATEGORY_LABELS[active.category as AdminCategory]
    : active?.title ?? ''

  return (
    <div className="glass-panel rounded-[2rem] p-6">
      <p className="text-[11px] font-extrabold text-fm-outline-variant uppercase tracking-widest mb-4">
        Marcación de asistencia
      </p>

      {active ? (
        /* ── Active entry ── */
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-fm-primary opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-fm-primary" />
              </span>
              <div>
                <p className="text-sm font-bold text-fm-on-surface">{activeLabel}</p>
                <p className="text-xs text-fm-on-surface-variant">
                  Inició {new Date(active.started_at).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false })}
                </p>
              </div>
            </div>
            <div className="text-3xl font-black text-fm-primary tabular-nums sm:ml-4">
              {formatDuration(elapsed)}
            </div>
            <button
              onClick={handleStop}
              disabled={isPending}
              className="sm:ml-auto flex items-center gap-2 px-5 py-2.5 bg-fm-error text-white font-bold rounded-full hover:bg-fm-error-dim transition-all text-sm disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-base">stop_circle</span>
              Marcar salida
            </button>
          </div>

          {/* Notes on active entry */}
          {editingNotes ? (
            <div className="flex gap-2 items-end">
              <textarea
                value={activeNotesDraft}
                onChange={e => setActiveNotesDraft(e.target.value)}
                placeholder="Descripción (opcional)"
                rows={2}
                className="flex-1 border border-fm-surface-container-high rounded-xl px-3 py-2 text-sm text-fm-on-surface bg-fm-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-fm-primary/30 resize-none"
              />
              <button onClick={handleSaveActiveNotes} disabled={isPending} className="px-3 py-2 bg-fm-primary text-white text-xs font-bold rounded-xl disabled:opacity-60">
                {isPending ? '…' : 'Guardar'}
              </button>
              <button onClick={() => setEditingNotes(false)} className="px-3 py-2 text-fm-on-surface-variant text-xs font-bold rounded-xl border border-fm-surface-container-high">
                Cancelar
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {active.notes ? (
                <p className="text-xs text-fm-on-surface-variant flex-1">{active.notes}</p>
              ) : (
                <p className="text-xs text-fm-outline-variant flex-1 italic">Sin descripción</p>
              )}
              <button
                onClick={() => { setActiveNotesDraft(active.notes ?? ''); setEditingNotes(true) }}
                className="text-xs text-fm-on-surface-variant hover:text-fm-primary flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-sm">edit</span>
                {active.notes ? 'Editar' : 'Agregar descripción'}
              </button>
            </div>
          )}
        </div>
      ) : (
        /* ── Clock-in form ── */
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value as AdminCategory)}
              className="flex-1 border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm text-fm-on-surface bg-fm-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
            >
              {ADMIN_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{ADMIN_CATEGORY_LABELS[cat]}</option>
              ))}
            </select>
            <button
              onClick={handleStart}
              disabled={isPending}
              className="flex items-center gap-2 px-5 py-2.5 bg-fm-primary text-white font-bold rounded-full hover:bg-fm-primary-dim transition-all text-sm disabled:opacity-60 whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-base">login</span>
              Marcar entrada
            </button>
          </div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Descripción (opcional)"
            rows={2}
            className="w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm text-fm-on-surface bg-fm-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-fm-primary/30 resize-none"
          />
        </div>
      )}

      {error && (
        <p className="mt-3 text-xs text-fm-error font-semibold">{error}</p>
      )}
    </div>
  )
}
