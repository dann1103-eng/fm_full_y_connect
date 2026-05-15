'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { startShift, endShift, startBreak, endBreak, getMyActiveShift } from '@/app/actions/work-sessions'
import { stopActiveEntry } from '@/app/actions/time'
import { formatDuration } from '@/lib/domain/time'
import { clearAllTimerKeysForUser } from '@/lib/domain/timer'
import type { WorkSession, WorkSessionBreak, ShiftBreakType } from '@/types/db'
import { EndShiftConfirmDialog } from './EndShiftConfirmDialog'
import { ActiveTimerWarningDialog } from '@/components/layout/ActiveTimerWarningDialog'

function elapsedSeconds(from: string, to?: Date): number {
  const end = to ?? new Date()
  return Math.max(0, Math.round((end.getTime() - new Date(from).getTime()) / 1000))
}

function totalBreakSeconds(breaks: WorkSessionBreak[]): number {
  return breaks.reduce((sum, b) => {
    if (b.ended_at) return sum + elapsedSeconds(b.started_at, new Date(b.ended_at))
    return sum + elapsedSeconds(b.started_at)
  }, 0)
}

export function ShiftPanel() {
  const router = useRouter()
  const [shift, setShift] = useState<WorkSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [, setNow] = useState(0)
  const [endConfirm, setEndConfirm] = useState<{ open: boolean; label: string | null }>({ open: false, label: null })
  const [breakWarning, setBreakWarning] = useState<{
    open: boolean
    timerLabel: string | null
    breakType: 'lunch' | 'away' | null
  }>({ open: false, timerLabel: null, breakType: null })

  // Refrescar shift al montar
  useEffect(() => {
    let cancelled = false
    getMyActiveShift().then((s) => {
      if (!cancelled) {
        setShift(s)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Cronómetro vivo (1s)
  useEffect(() => {
    if (!shift) return
    const t = setInterval(() => setNow((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [shift])

  function refresh() {
    getMyActiveShift().then(setShift)
  }

  function handle(action: () => Promise<{ ok: true } | { error: string } | { ok: true; sessionId: string }>) {
    setError(null)
    startTransition(async () => {
      const r = await action()
      if ('error' in r) {
        setError(r.error)
        return
      }
      refresh()
      router.refresh()
    })
  }

  async function handleEndShift() {
    setError(null)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('No autenticado')
      return
    }
    const { data: activeEntry } = await supabase
      .from('time_entries')
      .select('id, title, entry_type')
      .eq('user_id', user.id)
      .is('ended_at', null)
      .maybeSingle()

    if (activeEntry) {
      const label = activeEntry.title || (activeEntry.entry_type === 'requirement' ? 'requerimiento' : 'tarea administrativa')
      setEndConfirm({ open: true, label })
      return
    }

    handle(() => endShift())
  }

  async function confirmEndShift() {
    setEndConfirm({ open: false, label: null })
    const stopRes = await stopActiveEntry()
    if ('error' in stopRes) {
      // No bloqueamos el flujo: endShift() cerrará defensivamente las entries abiertas
      console.warn('[confirmEndShift] stopActiveEntry falló, endShift cerrará entries:', stopRes.error)
    }
    // Limpiar localStorage para evitar timers "fantasma"
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) clearAllTimerKeysForUser(user.id)
    handle(() => endShift())
  }

  async function handleStartBreak(type: ShiftBreakType) {
    setError(null)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('No autenticado'); return }

    const { data: activeEntry } = await supabase
      .from('time_entries')
      .select('id, title, entry_type')
      .eq('user_id', user.id)
      .is('ended_at', null)
      .maybeSingle()

    if (activeEntry) {
      const label = activeEntry.title ||
        (activeEntry.entry_type === 'requirement' ? 'requerimiento' : 'tarea administrativa')
      setBreakWarning({ open: true, timerLabel: label, breakType: type })
      return
    }
    handle(() => startBreak(type))
  }

  if (loading) {
    return (
      <div className="glass-panel rounded-2xl p-5 text-sm text-fm-on-surface-variant">Cargando…</div>
    )
  }

  if (!shift) {
    return (
      <div className="glass-panel rounded-2xl p-5 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm font-semibold text-fm-on-surface">Jornada</p>
          <p className="text-xs text-fm-on-surface-variant mt-0.5">
            Marca tu entrada para empezar a registrar tu tiempo online.
          </p>
        </div>
        <button
          type="button"
          onClick={() => handle(() => startShift())}
          disabled={isPending}
          className="px-4 py-2 rounded-full bg-fm-primary text-white font-bold text-sm hover:bg-fm-primary-dim disabled:opacity-60"
        >
          Iniciar jornada
        </button>
        {error && <p className="w-full text-xs text-fm-error">{error}</p>}
      </div>
    )
  }

  const breaks = (shift.breaks_json ?? []) as WorkSessionBreak[]
  const elapsed = elapsedSeconds(shift.started_at)
  const breaksSec = totalBreakSeconds(breaks)
  const onlineSec = Math.max(0, elapsed - breaksSec)
  const onBreak = shift.status === 'on_lunch' || shift.status === 'on_away'
  const lastBreak = onBreak ? breaks[breaks.length - 1] : null

  return (
    <div className="glass-panel rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full ${onBreak ? 'bg-fm-error' : 'bg-fm-primary animate-pulse'}`}
        />
        <p className="text-sm font-semibold text-fm-on-surface">Jornada activa</p>
        <span className="ml-auto text-xs text-fm-on-surface-variant">
          Inició {new Date(shift.started_at).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-fm-surface-container-low border border-fm-surface-container-high p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fm-on-surface-variant">Online</p>
          <p className="text-xl font-bold text-fm-on-surface tabular-nums mt-1">{formatDuration(onlineSec)}</p>
        </div>
        <div className="rounded-xl bg-fm-surface-container-low border border-fm-surface-container-high p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fm-on-surface-variant">Pausas</p>
          <p className="text-xl font-bold text-fm-on-surface tabular-nums mt-1">{formatDuration(breaksSec)}</p>
        </div>
        <div className="rounded-xl bg-fm-surface-container-low border border-fm-surface-container-high p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fm-on-surface-variant">Total</p>
          <p className="text-xl font-bold text-fm-on-surface tabular-nums mt-1">{formatDuration(elapsed)}</p>
        </div>
      </div>

      {onBreak && lastBreak && (
        <div className="rounded-xl bg-fm-error/10 border border-fm-error/30 p-3 flex items-center justify-between">
          <p className="text-sm text-fm-error font-semibold">
            En {lastBreak.type === 'lunch' ? 'almuerzo' : 'away'} desde{' '}
            {new Date(lastBreak.started_at).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <button
            type="button"
            onClick={() => handle(() => endBreak())}
            disabled={isPending}
            className="px-3 py-1.5 rounded-full bg-fm-primary text-white text-xs font-bold hover:bg-fm-primary-dim disabled:opacity-60"
          >
            Reanudar
          </button>
        </div>
      )}

      {!onBreak && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleStartBreak('lunch')}
            disabled={isPending}
            className="px-3 py-1.5 rounded-full bg-fm-surface-container-low border border-fm-surface-container-high text-xs font-semibold text-fm-on-surface hover:bg-fm-background disabled:opacity-60"
          >
            Almuerzo
          </button>
          <button
            type="button"
            onClick={() => handleStartBreak('away')}
            disabled={isPending}
            className="px-3 py-1.5 rounded-full bg-fm-surface-container-low border border-fm-surface-container-high text-xs font-semibold text-fm-on-surface hover:bg-fm-background disabled:opacity-60"
          >
            Away
          </button>
          <button
            type="button"
            onClick={handleEndShift}
            disabled={isPending}
            className="ml-auto px-3 py-1.5 rounded-full bg-fm-error/10 text-fm-error border border-fm-error/30 text-xs font-bold hover:bg-fm-error/15 disabled:opacity-60"
          >
            Finalizar jornada
          </button>
        </div>
      )}

      {error && <p className="text-xs text-fm-error">{error}</p>}

      <EndShiftConfirmDialog
        open={endConfirm.open}
        timerLabel={endConfirm.label}
        onConfirm={confirmEndShift}
        onCancel={() => setEndConfirm({ open: false, label: null })}
      />

      <ActiveTimerWarningDialog
        open={breakWarning.open}
        timerLabel={breakWarning.timerLabel}
        breakType={breakWarning.breakType}
        onDismiss={() => setBreakWarning({ open: false, timerLabel: null, breakType: null })}
      />
    </div>
  )
}
