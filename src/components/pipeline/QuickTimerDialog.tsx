'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import type { ContentType, Phase } from '@/types/db'
import { isUserTrackedPhase } from '@/lib/domain/pipeline'
import { startTimer, stopTimer, TIMER_KEY, type ActiveTimer } from '@/lib/domain/timer'

interface QuickTimerDialogProps {
  open: boolean
  onClose: () => void
  requirementId: string
  currentUserId: string
  title: string
  notes: string | null
  clientName: string
  contentType: ContentType
  currentPhase: Phase
  assignees?: { id: string; name: string; avatar_url: string | null }[]
  /** ISO timestamp when the event starts. Used to enforce the time window. */
  startsAt: string | null
  /** Duration in minutes. Defaults to 60 when null. */
  estimatedTimeMinutes: number | null
  /** Si está presente (admin/supervisor), muestra botón "Editar" en el header. */
  onEdit?: () => void
}

function formatClock(seconds: number): string {
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0')
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
  const s = String(seconds % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
  } catch {
    return iso
  }
}

/** Returns true if now is within [startsAt - 15min, startsAt + duration + 15min]. */
function isWithinEventWindow(startsAt: string, durationMinutes: number): boolean {
  const start = new Date(startsAt).getTime()
  const end = start + durationMinutes * 60 * 1000
  const now = new Date().getTime()
  const buffer = 15 * 60 * 1000
  return now >= start - buffer && now <= end + buffer
}

export function QuickTimerDialog({
  open,
  onClose,
  requirementId,
  currentUserId,
  title,
  notes,
  clientName,
  contentType,
  currentPhase,
  assignees = [],
  startsAt,
  estimatedTimeMinutes,
  onEdit,
}: QuickTimerDialogProps) {
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasActiveShift, setHasActiveShift] = useState<boolean | null>(null)
  // Timer activo en OTRO requerimiento/actividad (bloquea iniciar uno aquí).
  const [otherActive, setOtherActive] = useState<{ title: string } | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.resolve().then(async () => {
      if (cancelled) return
      setError(null)
      const supabase = createClient()

      // Fuente de verdad: la entrada activa del usuario en la DB (el índice único
      // garantiza a lo sumo una). Reconciliamos el estado local contra ella en vez
      // de confiar en el localStorage por-requerimiento, que puede quedar stale o
      // mostrar timers fantasma entre pestañas.
      const { data: dbActive } = await supabase
        .from('time_entries')
        .select('id, started_at, title, phase, requirement_id')
        .eq('user_id', currentUserId)
        .is('ended_at', null)
        .maybeSingle()

      if (cancelled) return

      const keyThis = TIMER_KEY(requirementId, currentUserId)

      if (dbActive && dbActive.requirement_id === requirementId) {
        // Timer activo para ESTE requerimiento.
        const t: ActiveTimer = {
          entryId: dbActive.id as string,
          startedAt: new Date(dbActive.started_at as string).getTime(),
          title: (dbActive.title as string) || title,
          phase: (dbActive.phase as string) || currentPhase,
        }
        setActiveTimer(t)
        setElapsed(Math.floor((new Date().getTime() - t.startedAt) / 1000))
        setOtherActive(null)
        if (typeof window !== 'undefined') localStorage.setItem(keyThis, JSON.stringify(t))
      } else if (dbActive) {
        // Hay un timer activo, pero en OTRO requerimiento (o administrativo).
        setActiveTimer(null)
        setElapsed(0)
        setOtherActive({ title: (dbActive.title as string)?.trim() || 'otra actividad' })
        if (typeof window !== 'undefined') localStorage.removeItem(keyThis)
      } else {
        // No hay ningún timer activo → limpiar estado + localStorage stale.
        setActiveTimer(null)
        setElapsed(0)
        setOtherActive(null)
        if (typeof window !== 'undefined') localStorage.removeItem(keyThis)
      }

      // Verificar si el usuario tiene jornada activa
      const { data: shift } = await supabase
        .from('work_sessions')
        .select('id')
        .eq('user_id', currentUserId)
        .is('ended_at', null)
        .maybeSingle()
      if (!cancelled) setHasActiveShift(!!shift)
    })
    return () => { cancelled = true }
  }, [open, requirementId, currentUserId, title, currentPhase])

  useEffect(() => {
    if (!activeTimer) return
    const id = setInterval(() => {
      setElapsed(Math.floor((new Date().getTime() - activeTimer.startedAt) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [activeTimer])

  const duration = estimatedTimeMinutes ?? 60
  const canStart = !startsAt || isWithinEventWindow(startsAt, duration)

  const windowLabel = (() => {
    if (!startsAt) return null
    const start = new Date(startsAt)
    const end = new Date(start.getTime() + duration * 60 * 1000)
    const now = new Date().getTime()
    if (now < start.getTime() - 15 * 60 * 1000) {
      return `El evento comienza a las ${formatTime(startsAt)}`
    }
    if (now > end.getTime() + 15 * 60 * 1000) {
      return `El evento finalizó a las ${formatTime(end.toISOString())}`
    }
    return null
  })()

  async function handleStart() {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const phase = isUserTrackedPhase(currentPhase) ? currentPhase : 'proceso_edicion'
    const { timer, error } = await startTimer(supabase, {
      requirementId,
      userId: currentUserId,
      title: title || CONTENT_TYPE_LABELS[contentType],
      phase,
    })
    setBusy(false)
    if (error) { setError(error); return }
    if (timer) {
      setActiveTimer(timer)
      setElapsed(0)
    }
  }

  async function handleStop() {
    if (!activeTimer) return
    setBusy(true)
    const supabase = createClient()
    const { error } = await stopTimer(supabase, {
      timer: activeTimer,
      requirementId,
      userId: currentUserId,
    })
    setBusy(false)
    if (error) { setError(error); return }
    setActiveTimer(null)
    setElapsed(0)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-fm-primary/10 text-fm-primary">
              {CONTENT_TYPE_LABELS[contentType]}
            </span>
            <span className="text-[10px] text-fm-outline">{clientName}</span>
          </div>
          <div className="flex items-start justify-between gap-2">
            <DialogTitle className="text-base font-semibold text-fm-on-surface">
              {title || CONTENT_TYPE_LABELS[contentType]}
            </DialogTitle>
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="text-xs font-semibold text-fm-primary hover:underline flex-shrink-0"
              >
                Editar
              </button>
            )}
          </div>
        </DialogHeader>

        {notes && (
          <div className="space-y-0.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-fm-outline-variant">
              Descripción
            </p>
            <p className="text-sm text-fm-on-surface whitespace-pre-wrap">{notes}</p>
          </div>
        )}

        {assignees.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-fm-outline-variant">
              Asignados
            </p>
            <div className="flex flex-wrap gap-1.5">
              {assignees.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1.5 bg-fm-background rounded-full px-2 py-1"
                >
                  <span className="w-5 h-5 rounded-full bg-fm-primary/15 flex items-center justify-center text-[9px] font-bold text-fm-primary overflow-hidden">
                    {a.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.avatar_url} alt={a.name} className="w-full h-full object-cover" />
                    ) : (
                      a.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
                    )}
                  </span>
                  <span className="text-xs font-semibold text-fm-on-surface">{a.name}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-2xl p-4 border border-fm-primary/25 bg-fm-primary/5 text-center">
          {activeTimer ? (
            <>
              <p className="text-[10px] font-bold text-fm-primary uppercase tracking-wider mb-1">
                Timer activo
              </p>
              <p className="text-3xl font-black text-fm-primary tabular-nums">
                {formatClock(elapsed)}
              </p>
            </>
          ) : (
            <p className="text-sm text-fm-on-surface-variant">
              No hay timer activo para este requerimiento.
            </p>
          )}
        </div>

        {windowLabel && (
          <p className="text-xs text-fm-outline bg-fm-surface-container-low rounded-lg px-3 py-2 flex items-center gap-1.5">
            <span>🕐</span> {windowLabel}
          </p>
        )}

        {hasActiveShift === false && (
          <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2 flex items-center gap-1.5 border border-amber-500/20">
            <span className="material-symbols-outlined text-[16px]">schedule</span>
            Inicia tu jornada laboral antes de registrar tiempo.
          </p>
        )}

        {otherActive && !activeTimer && (
          <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2 flex items-center gap-1.5 border border-amber-500/20">
            <span className="material-symbols-outlined text-[16px]">timer</span>
            Ya tienes un timer activo en «{otherActive.title}». Detenlo antes de iniciar otro.
          </p>
        )}

        {error && (
          <p className="text-xs text-fm-error bg-fm-error/5 rounded-lg px-3 py-2 border border-fm-error/20">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 rounded-xl h-10"
          >
            Cerrar
          </Button>
          {activeTimer ? (
            <Button
              onClick={handleStop}
              disabled={busy}
              className="flex-1 rounded-xl h-10 text-white font-semibold bg-fm-error hover:bg-fm-error-dim"
            >
              {busy ? 'Deteniendo…' : 'Detener timer'}
            </Button>
          ) : (
            <Button
              onClick={handleStart}
              disabled={busy || !canStart || hasActiveShift === false || !!otherActive}
              title={
                otherActive
                  ? `Ya tienes un timer activo en «${otherActive.title}»`
                  : hasActiveShift === false
                    ? 'Debes iniciar tu jornada laboral antes de registrar tiempo'
                    : windowLabel ?? undefined
              }
              className="flex-1 rounded-xl h-10 text-white font-semibold disabled:opacity-50"
              style={canStart && hasActiveShift !== false && !otherActive ? { background: 'linear-gradient(135deg,#00675c,#5bf4de)' } : {}}
            >
              {busy ? 'Iniciando…' : 'Iniciar timer'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
