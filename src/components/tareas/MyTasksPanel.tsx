'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { startTaskTimer, markTaskDone } from '@/app/actions/tasks'
import { stopActiveEntry } from '@/app/actions/time'
import { formatDuration, formatDurationHMS } from '@/lib/domain/time'
import { TaskStatusBadge } from './TaskStatusBadge'
import type { TimeEntry } from '@/types/db'
import type { TaskVM } from './types'

interface Props {
  activos: TaskVM[]
  historial: TaskVM[]
  activeEntry: TimeEntry | null
  /** true si el admin está suplantando: las acciones de timer están bloqueadas. */
  disabled?: boolean
}

export function MyTasksPanel({ activos, historial, activeEntry, disabled = false }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmDoneId, setConfirmDoneId] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const activeTaskId = activeEntry?.entry_type === 'task' ? activeEntry.task_id : null

  // Contador en vivo del timer de la tarea activa.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!activeEntry) { setElapsed(0); return }
    const calc = () => {
      setElapsed(Math.round((new Date().getTime() - new Date(activeEntry.started_at).getTime()) / 1000))
    }
    calc()
    const id = setInterval(calc, 1000)
    return () => clearInterval(id)
  }, [activeEntry])

  const totalDone = historial
    .filter((t) => t.status === 'done')
    .reduce((sum, t) => sum + t.seconds, 0)
  const totalActivo = activos.reduce((sum, t) => sum + t.seconds, 0)

  function handleStart(taskId: string) {
    setError(null)
    startTransition(async () => {
      const res = await startTaskTimer(taskId)
      if ('error' in res) { setError(res.error); return }
      router.refresh()
    })
  }

  function handleStop() {
    setError(null)
    startTransition(async () => {
      const res = await stopActiveEntry()
      if (res.error) { setError(res.error); return }
      router.refresh()
    })
  }

  function handleDone(taskId: string) {
    setError(null)
    startTransition(async () => {
      const res = await markTaskDone(taskId)
      if ('error' in res) { setError(res.error); return }
      setConfirmDoneId(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {/* Contadores */}
      <div className="grid grid-cols-2 gap-4">
        <div className="glass-panel rounded-3xl p-5">
          <p className="text-[11px] font-extrabold text-fm-outline-variant uppercase tracking-widest">Horas en tareas finalizadas</p>
          <p className="text-3xl font-black text-fm-primary tabular-nums mt-1">{formatDuration(totalDone)}</p>
        </div>
        <div className="glass-panel rounded-3xl p-5">
          <p className="text-[11px] font-extrabold text-fm-outline-variant uppercase tracking-widest">Horas en tareas activas</p>
          <p className="text-3xl font-black text-fm-on-surface tabular-nums mt-1">{formatDuration(totalActivo)}</p>
        </div>
      </div>

      {error && (
        <p className="text-xs text-fm-error font-semibold bg-fm-error/5 border border-fm-error/20 rounded-xl px-3 py-2">{error}</p>
      )}

      {/* Tareas activas */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-fm-on-surface">Tareas asignadas</h2>
        {activos.length === 0 ? (
          <p className="text-sm text-fm-on-surface-variant bg-fm-surface-container-lowest border border-fm-surface-container-high rounded-2xl p-6 text-center">
            No tienes tareas pendientes. 🎉
          </p>
        ) : (
          activos.map((t) => {
            const isTiming = activeTaskId === t.id
            const timerBusyElsewhere = activeEntry !== null && !isTiming
            const shownSeconds = t.seconds + (isTiming ? elapsed : 0)
            return (
              <div key={t.id} className="bg-fm-surface-container-lowest border border-fm-surface-container-high rounded-2xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-fm-on-surface">{t.title}</p>
                      <TaskStatusBadge status={t.status} />
                    </div>
                    {t.client_ref && (
                      <p className="text-xs text-fm-on-surface-variant mt-0.5">
                        <span className="material-symbols-outlined text-[13px] align-middle mr-1">business</span>
                        {t.client_ref}
                      </p>
                    )}
                    {t.description && (
                      <p className="text-xs text-fm-on-surface-variant mt-1 whitespace-pre-wrap">{t.description}</p>
                    )}
                    <p className="text-[11px] text-fm-outline-variant mt-1">Asignada por {t.creator_name}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[10px] uppercase tracking-widest text-fm-outline-variant font-bold">Acumulado</p>
                    <p className={`text-lg font-black tabular-nums ${isTiming ? 'text-fm-primary' : 'text-fm-on-surface'}`}>
                      {isTiming ? formatDurationHMS(shownSeconds) : formatDuration(shownSeconds)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {isTiming ? (
                    <button
                      type="button"
                      onClick={handleStop}
                      disabled={isPending || disabled}
                      className="flex items-center gap-2 px-4 py-2 bg-fm-error text-white text-sm font-bold rounded-full hover:bg-fm-error-dim transition-all disabled:opacity-60"
                    >
                      <span className="material-symbols-outlined text-base">stop_circle</span>
                      Detener timer
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleStart(t.id)}
                      disabled={isPending || disabled || timerBusyElsewhere}
                      title={timerBusyElsewhere ? 'Detén tu timer activo antes de iniciar otro' : undefined}
                      className="flex items-center gap-2 px-4 py-2 bg-fm-primary text-white text-sm font-bold rounded-full hover:bg-fm-primary-dim transition-all disabled:opacity-60"
                    >
                      <span className="material-symbols-outlined text-base">play_circle</span>
                      Iniciar timer
                    </button>
                  )}

                  {confirmDoneId === t.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-fm-on-surface-variant">¿Marcar como finalizada?</span>
                      <button
                        type="button"
                        onClick={() => handleDone(t.id)}
                        disabled={isPending || disabled}
                        className="px-3 py-1.5 bg-fm-primary text-white text-xs font-bold rounded-full disabled:opacity-60"
                      >
                        Sí, finalizar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDoneId(null)}
                        className="px-3 py-1.5 text-fm-on-surface-variant text-xs font-bold rounded-full border border-fm-surface-container-high"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDoneId(t.id)}
                      disabled={isPending || disabled}
                      className="flex items-center gap-2 px-4 py-2 text-fm-on-surface-variant text-sm font-bold rounded-full border border-fm-surface-container-high hover:bg-fm-background transition-all disabled:opacity-60"
                    >
                      <span className="material-symbols-outlined text-base">check_circle</span>
                      Finalizar
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </section>

      {/* Historial */}
      {historial.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-fm-on-surface">Historial</h2>
          <div className="bg-fm-surface-container-lowest border border-fm-surface-container-high rounded-2xl divide-y divide-fm-surface-container-high">
            {historial.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-fm-on-surface truncate">{t.title}</p>
                    <TaskStatusBadge status={t.status} />
                  </div>
                  {t.client_ref && <p className="text-xs text-fm-on-surface-variant mt-0.5">{t.client_ref}</p>}
                  {t.completed_at && t.status === 'done' && (
                    <p className="text-[11px] text-fm-outline-variant mt-0.5">
                      Finalizada {new Date(t.completed_at).toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  )}
                </div>
                <p className="text-sm font-bold text-fm-on-surface tabular-nums flex-shrink-0">{formatDuration(t.seconds)}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
