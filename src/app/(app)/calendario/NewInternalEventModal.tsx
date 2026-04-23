'use client'

import { useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createInternalEvent } from '@/app/actions/calendar'

interface Props {
  open: boolean
  onClose: () => void
  initialDatetime?: string
  allUsers: { id: string; full_name: string }[]
  currentUserId: string
}

export function NewInternalEventModal({ open, onClose, initialDatetime = '', allUsers, currentUserId }: Props) {
  const [title, setTitle] = useState('')
  const [scheduledAt, setScheduledAt] = useState(initialDatetime)
  const [duration, setDuration] = useState('')
  const [attendees, setAttendees] = useState<string[]>([currentUserId])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleClose() {
    setTitle('')
    setScheduledAt(initialDatetime)
    setDuration('')
    setAttendees([currentUserId])
    setNotes('')
    setError(null)
    onClose()
  }

  function handleSubmit() {
    setError(null)
    if (!title.trim()) { setError('El título es obligatorio.'); return }
    if (!scheduledAt) { setError('La fecha y hora son obligatorias.'); return }
    const mins = parseInt(duration, 10)
    if (!mins || isNaN(mins) || mins < 1) { setError('La duración es obligatoria.'); return }
    if (attendees.length === 0) { setError('Selecciona al menos un participante.'); return }

    startTransition(async () => {
      const res = await createInternalEvent({
        title: title.trim(),
        scheduled_at: new Date(scheduledAt).toISOString(),
        scheduled_duration_minutes: mins,
        scheduled_attendees: attendees,
        notes: notes.trim() || undefined,
      })
      if (res.error) { setError(res.error); return }
      handleClose()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-md rounded-2xl border border-fm-outline-variant/20 shadow-xl p-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-fm-surface-container-low flex-shrink-0">
          <DialogTitle className="text-lg font-semibold text-fm-on-surface">Nueva reunión interna</DialogTitle>
          <p className="text-xs text-fm-on-surface-variant mt-0.5">El timer no inicia automáticamente — cada persona marca su tiempo.</p>
        </DialogHeader>

        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          <div>
            <Label htmlFor="ie-title" className="text-sm font-medium text-fm-on-surface mb-1.5 block">
              Título <span className="text-fm-error">*</span>
            </Label>
            <input
              id="ie-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ej. Reunión de planificación"
              className="w-full px-3 py-2 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl focus:outline-none focus:border-fm-primary text-fm-on-surface"
            />
          </div>

          <div>
            <Label htmlFor="ie-starts" className="text-sm font-medium text-fm-on-surface mb-1.5 block">
              Fecha y hora <span className="text-fm-error">*</span>
            </Label>
            <input
              id="ie-starts"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl focus:outline-none focus:border-fm-primary text-fm-on-surface"
            />
          </div>

          <div>
            <Label htmlFor="ie-duration" className="text-sm font-medium text-fm-on-surface mb-1.5 block">
              Duración (min) <span className="text-fm-error">*</span>
            </Label>
            <input
              id="ie-duration"
              type="number"
              min="1"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="ej. 60"
              className="w-full px-3 py-2 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl focus:outline-none focus:border-fm-primary text-fm-on-surface"
            />
          </div>

          <div>
            <Label className="text-sm font-medium text-fm-on-surface mb-1.5 block">
              Participantes <span className="text-fm-error">*</span>
            </Label>
            <div className="bg-fm-background border border-fm-surface-container-high rounded-xl px-3 py-2 space-y-1.5 max-h-40 overflow-y-auto">
              {allUsers.map((u) => {
                const checked = attendees.includes(u.id)
                return (
                  <label key={u.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setAttendees(prev =>
                        checked ? prev.filter(id => id !== u.id) : [...prev, u.id]
                      )}
                      className="rounded accent-fm-primary"
                    />
                    <span className="text-sm text-fm-on-surface">
                      {u.full_name}
                      {u.id === currentUserId && <span className="text-xs text-fm-outline ml-1">(tú)</span>}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>

          <div>
            <Label htmlFor="ie-notes" className="text-sm font-medium text-fm-on-surface mb-1.5 block">
              Notas <span className="text-fm-outline font-normal">(opcional)</span>
            </Label>
            <Textarea
              id="ie-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Agenda, contexto, etc."
              className="resize-none bg-fm-background border-fm-surface-container-high focus:border-fm-primary rounded-xl"
              rows={3}
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-fm-surface-container-low flex-shrink-0 space-y-3">
          {error && (
            <p className="text-sm text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleClose}
              className="flex-1 rounded-xl border-fm-surface-container-high text-fm-on-surface-variant"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isPending || !title.trim() || !scheduledAt || !duration}
              className="flex-1 rounded-xl text-white font-semibold"
              style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
            >
              {isPending ? 'Guardando...' : 'Crear reunión'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
