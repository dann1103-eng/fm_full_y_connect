'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { reassignTask, cancelTask } from '@/app/actions/tasks'
import { formatDuration } from '@/lib/domain/time'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { AssignTaskModal } from './AssignTaskModal'
import { TaskStatusBadge } from './TaskStatusBadge'
import { TASK_STATUS_LABELS } from '@/types/db'
import type { TaskStatus } from '@/types/db'
import type { TaskStaffUser, TaskVM } from './types'

interface Props {
  initialTasks: TaskVM[]
  staff: TaskStaffUser[]
  currentUserId: string
}

type ModalState = { mode: 'create' } | { mode: 'edit'; task: TaskVM } | null

const STATUS_ORDER: TaskStatus[] = ['pending', 'in_progress', 'done', 'cancelled']

export function TaskManagerPanel({ initialTasks, staff }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [modal, setModal] = useState<ModalState>(null)
  const [filterAssignee, setFilterAssignee] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [reassigningId, setReassigningId] = useState<string | null>(null)
  const [reassignTo, setReassignTo] = useState<string>('')
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const counts = useMemo(() => {
    const c: Record<TaskStatus, number> = { pending: 0, in_progress: 0, done: 0, cancelled: 0 }
    for (const t of initialTasks) c[t.status]++
    return c
  }, [initialTasks])

  const filtered = useMemo(() => {
    return initialTasks.filter((t) => {
      if (filterAssignee !== 'all' && t.assigned_to_user_id !== filterAssignee) return false
      if (filterStatus !== 'all' && t.status !== filterStatus) return false
      return true
    })
  }, [initialTasks, filterAssignee, filterStatus])

  function handleReassign(taskId: string) {
    if (!reassignTo) { setReassigningId(null); return }
    setError(null)
    startTransition(async () => {
      const res = await reassignTask(taskId, reassignTo)
      if ('error' in res) { setError(res.error); return }
      setReassigningId(null)
      setReassignTo('')
      router.refresh()
    })
  }

  function handleCancel(taskId: string) {
    setError(null)
    startTransition(async () => {
      const res = await cancelTask(taskId)
      if ('error' in res) { setError(res.error); return }
      setConfirmCancelId(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      {/* Header + acción */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_ORDER.map((s) => (
            <span key={s} className="text-xs font-semibold text-fm-on-surface-variant bg-fm-surface-container-lowest border border-fm-surface-container-high rounded-full px-3 py-1">
              {counts[s]} {TASK_STATUS_LABELS[s].toLowerCase()}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setModal({ mode: 'create' })}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white rounded-full whitespace-nowrap"
          style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
        >
          <span className="material-symbols-outlined text-base">add_task</span>
          Asignar tarea
        </button>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={filterAssignee}
          onChange={(e) => setFilterAssignee(e.target.value)}
          className="border border-fm-surface-container-high rounded-xl px-3 py-2 text-sm bg-fm-background text-fm-on-surface"
        >
          <option value="all">Todos los responsables</option>
          {staff.map((u) => (
            <option key={u.id} value={u.id}>{u.full_name}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-fm-surface-container-high rounded-xl px-3 py-2 text-sm bg-fm-background text-fm-on-surface"
        >
          <option value="all">Todos los estados</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {error && (
        <p className="text-xs text-fm-error font-semibold bg-fm-error/5 border border-fm-error/20 rounded-xl px-3 py-2">{error}</p>
      )}

      {/* Lista */}
      {filtered.length === 0 ? (
        <p className="text-sm text-fm-on-surface-variant bg-fm-surface-container-lowest border border-fm-surface-container-high rounded-2xl p-8 text-center">
          No hay tareas que coincidan con el filtro.
        </p>
      ) : (
        <div className="bg-fm-surface-container-lowest border border-fm-surface-container-high rounded-2xl divide-y divide-fm-surface-container-high">
          {filtered.map((t) => {
            const canModify = t.status !== 'done' && t.status !== 'cancelled'
            return (
              <div key={t.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-fm-on-surface">{t.title}</p>
                      <TaskStatusBadge status={t.status} />
                    </div>
                    {t.client_ref && <p className="text-xs text-fm-on-surface-variant mt-0.5">{t.client_ref}</p>}
                    {t.description && <p className="text-xs text-fm-on-surface-variant mt-1 line-clamp-2 whitespace-pre-wrap">{t.description}</p>}
                    <div className="flex items-center gap-2 mt-2">
                      <UserAvatar name={t.assignee_name} avatarUrl={t.assignee_avatar} size="sm" />
                      <span className="text-xs text-fm-on-surface-variant">{t.assignee_name}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[10px] uppercase tracking-widest text-fm-outline-variant font-bold">Horas</p>
                    <p className="text-base font-black text-fm-on-surface tabular-nums">{formatDuration(t.seconds)}</p>
                  </div>
                </div>

                {/* Reasignar inline */}
                {reassigningId === t.id ? (
                  <div className="flex items-center gap-2 flex-wrap bg-fm-background rounded-xl p-2">
                    <select
                      value={reassignTo}
                      onChange={(e) => setReassignTo(e.target.value)}
                      className="border border-fm-surface-container-high rounded-lg px-3 py-1.5 text-sm bg-fm-surface-container-lowest text-fm-on-surface"
                    >
                      <option value="">Elegir responsable…</option>
                      {staff.filter((u) => u.id !== t.assigned_to_user_id).map((u) => (
                        <option key={u.id} value={u.id}>{u.full_name}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => handleReassign(t.id)} disabled={isPending || !reassignTo} className="px-3 py-1.5 bg-fm-primary text-white text-xs font-bold rounded-full disabled:opacity-60">
                      Reasignar
                    </button>
                    <button type="button" onClick={() => { setReassigningId(null); setReassignTo('') }} className="px-3 py-1.5 text-fm-on-surface-variant text-xs font-bold rounded-full border border-fm-surface-container-high">
                      Cancelar
                    </button>
                  </div>
                ) : confirmCancelId === t.id ? (
                  <div className="flex items-center gap-2 flex-wrap bg-fm-error/5 rounded-xl p-2">
                    <span className="text-xs text-fm-on-surface-variant">¿Cancelar esta tarea? El tiempo registrado se conserva.</span>
                    <button type="button" onClick={() => handleCancel(t.id)} disabled={isPending} className="px-3 py-1.5 bg-fm-error text-white text-xs font-bold rounded-full disabled:opacity-60">
                      Sí, cancelar
                    </button>
                    <button type="button" onClick={() => setConfirmCancelId(null)} className="px-3 py-1.5 text-fm-on-surface-variant text-xs font-bold rounded-full border border-fm-surface-container-high">
                      No
                    </button>
                  </div>
                ) : canModify ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" onClick={() => setModal({ mode: 'edit', task: t })} className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-fm-on-surface-variant rounded-full border border-fm-surface-container-high hover:bg-fm-background">
                      <span className="material-symbols-outlined text-sm">edit</span> Editar
                    </button>
                    <button type="button" onClick={() => { setReassigningId(t.id); setReassignTo('') }} className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-fm-on-surface-variant rounded-full border border-fm-surface-container-high hover:bg-fm-background">
                      <span className="material-symbols-outlined text-sm">swap_horiz</span> Reasignar
                    </button>
                    <button type="button" onClick={() => setConfirmCancelId(t.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-fm-error rounded-full border border-fm-error/30 hover:bg-fm-error/5">
                      <span className="material-symbols-outlined text-sm">cancel</span> Cancelar
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {modal && (
        <AssignTaskModal
          mode={modal.mode}
          staff={staff}
          initial={modal.mode === 'edit' ? {
            id: modal.task.id,
            title: modal.task.title,
            description: modal.task.description,
            client_ref: modal.task.client_ref,
          } : undefined}
          onClose={() => setModal(null)}
          onSaved={() => router.refresh()}
        />
      )}
    </div>
  )
}
