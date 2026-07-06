'use client'

import { useState, useTransition } from 'react'
import { createTask, editTask } from '@/app/actions/tasks'
import { UserAvatar } from '@/components/ui/UserAvatar'
import type { TaskStaffUser } from './types'

interface Props {
  mode: 'create' | 'edit'
  staff: TaskStaffUser[]
  /** En modo edit: valores actuales de la tarea. */
  initial?: {
    id: string
    title: string
    description: string | null
    client_ref: string | null
  }
  onClose: () => void
  onSaved: () => void
}

export function AssignTaskModal({ mode, staff, initial, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [clientRef, setClientRef] = useState(initial?.client_ref ?? '')
  const [assigneeId, setAssigneeId] = useState(staff[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!title.trim()) { setError('El título es obligatorio.'); return }
    if (mode === 'create' && !assigneeId) { setError('Debes elegir un responsable.'); return }

    startTransition(async () => {
      const res =
        mode === 'create'
          ? await createTask({
              title,
              description,
              clientRef,
              assignedToUserId: assigneeId,
            })
          : await editTask(initial!.id, { title, description, clientRef })
      if ('error' in res) { setError(res.error); return }
      onSaved()
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-fm-surface-container-lowest w-full sm:max-w-lg flex flex-col max-h-[90dvh] rounded-t-2xl sm:rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-fm-surface-container-high">
          <h2 className="text-base font-bold text-fm-on-surface">
            {mode === 'create' ? 'Asignar tarea' : 'Editar tarea'}
          </h2>
          <button type="button" onClick={onClose} className="text-fm-on-surface-variant hover:text-fm-on-surface">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-fm-on-surface">Título *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej. Preparar propuesta para reunión del viernes"
                className="w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm bg-fm-background text-fm-on-surface focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-fm-on-surface">Descripción</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Detalles de la tarea (opcional)"
                rows={3}
                className="w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm bg-fm-background text-fm-on-surface focus:outline-none focus:ring-2 focus:ring-fm-primary/30 resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-fm-on-surface">Cliente relacionado</label>
              <input
                value={clientRef}
                onChange={(e) => setClientRef(e.target.value)}
                placeholder="Texto libre (opcional)"
                className="w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm bg-fm-background text-fm-on-surface focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
              />
            </div>

            {mode === 'create' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-fm-on-surface">Responsable *</label>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm bg-fm-background text-fm-on-surface focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
                >
                  {staff.map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name}</option>
                  ))}
                </select>
                {assigneeId && (
                  <div className="flex items-center gap-2 pt-1">
                    {(() => {
                      const u = staff.find((s) => s.id === assigneeId)
                      return u ? (
                        <>
                          <UserAvatar name={u.full_name} avatarUrl={u.avatar_url} size="sm" />
                          <span className="text-xs text-fm-on-surface-variant capitalize">{u.role}</span>
                        </>
                      ) : null
                    })()}
                  </div>
                )}
              </div>
            )}

            {error && (
              <p className="text-xs text-fm-error font-semibold bg-fm-error/5 border border-fm-error/20 rounded-xl px-3 py-2">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex-shrink-0 flex items-center justify-end gap-2 px-6 py-4 border-t border-fm-surface-container-high">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-bold text-fm-on-surface-variant rounded-full border border-fm-surface-container-high">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-5 py-2 text-sm font-bold text-white rounded-full disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
            >
              {isPending ? 'Guardando…' : mode === 'create' ? 'Asignar' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
