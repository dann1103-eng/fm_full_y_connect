'use client'

import { useState, useEffect, useTransition } from 'react'
import { startAdminEntry, stopActiveEntry } from '@/app/actions/time'
import { ADMIN_CATEGORIES, ADMIN_CATEGORY_LABELS, formatDuration } from '@/lib/domain/time'
import type { AdminCategory, TimeEntry } from '@/types/db'

interface Props {
  initialActive: TimeEntry | null
}

export function ClockInPanel({ initialActive }: Props) {
  const [active, setActive] = useState<TimeEntry | null>(initialActive)
  const [selectedCategory, setSelectedCategory] = useState<AdminCategory>('administrativa')
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
      const res = await startAdminEntry(selectedCategory)
      if (res.error) { setError(res.error); return }
      // Optimistic: create a fake entry to show the timer immediately
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
        notes: null,
        created_at: new Date().toISOString(),
        requirement_id: null,
      })
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
      <p className="text-[11px] font-extrabold text-[#abadaf] uppercase tracking-widest mb-4">
        Marcación de asistencia
      </p>

      {active ? (
        /* ── Active entry ── */
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00675c] opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-[#00675c]" />
            </span>
            <div>
              <p className="text-sm font-bold text-[#2c2f31]">{activeLabel}</p>
              <p className="text-xs text-[#595c5e]">
                Inició {new Date(active.started_at).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false })}
              </p>
            </div>
          </div>

          <div className="text-3xl font-black text-[#00675c] tabular-nums sm:ml-4">
            {formatDuration(elapsed)}
          </div>

          <button
            onClick={handleStop}
            disabled={isPending}
            className="sm:ml-auto flex items-center gap-2 px-5 py-2.5 bg-[#b31b25] text-white font-bold rounded-full hover:bg-[#8f141c] transition-all text-sm disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-base">stop_circle</span>
            Marcar salida
          </button>
        </div>
      ) : (
        /* ── Clock-in form ── */
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value as AdminCategory)}
            className="flex-1 border border-[#dfe3e6] rounded-xl px-4 py-2.5 text-sm text-[#2c2f31] bg-white focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
          >
            {ADMIN_CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{ADMIN_CATEGORY_LABELS[cat]}</option>
            ))}
          </select>

          <button
            onClick={handleStart}
            disabled={isPending}
            className="flex items-center gap-2 px-5 py-2.5 bg-[#00675c] text-white font-bold rounded-full hover:bg-[#005047] transition-all text-sm disabled:opacity-60 whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-base">login</span>
            Marcar entrada
          </button>
        </div>
      )}

      {error && (
        <p className="mt-3 text-xs text-[#b31b25] font-semibold">{error}</p>
      )}
    </div>
  )
}
