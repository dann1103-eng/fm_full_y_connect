'use client'

import { useState, useTransition } from 'react'
import { adminEditWorkSession } from '@/app/actions/work-sessions'
import type { WorkSession, WorkSessionBreak } from '@/types/db'

interface Props {
  session: WorkSession
  onSaved: () => void
  onCancel: () => void
}

/** Convierte ISO a valor compatible con <input type="datetime-local"> en hora local. */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export function EditWorkSessionModal({ session, onSaved, onCancel }: Props) {
  const [startedAt, setStartedAt] = useState(toDatetimeLocal(session.started_at))
  const [endedAt, setEndedAt] = useState(
    session.ended_at
      ? toDatetimeLocal(session.ended_at)
      : toDatetimeLocal(new Date().toISOString()),
  )
  const [notes, setNotes] = useState(session.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const breaks = (session.breaks_json ?? []) as WorkSessionBreak[]

  function handleSave() {
    if (!startedAt || !endedAt) {
      setError('Las fechas de inicio y fin son obligatorias.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await adminEditWorkSession(session.id, {
        started_at: new Date(startedAt).toISOString(),
        ended_at: new Date(endedAt).toISOString(),
        notes: notes.trim() || null,
      })
      if ('error' in res) { setError(res.error); return }
      onSaved()
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-fm-surface-container-lowest rounded-[2rem] shadow-2xl w-full max-w-md p-8 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-fm-on-surface">Editar jornada</h3>
          <button
            onClick={onCancel}
            className="p-1 rounded-full hover:bg-fm-background text-fm-on-surface-variant"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Campos de hora */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">
              Inicio
            </label>
            <input
              type="datetime-local"
              value={startedAt}
              onChange={e => setStartedAt(e.target.value)}
              className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30 bg-fm-surface-container-low text-fm-on-surface"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">
              Fin
            </label>
            <input
              type="datetime-local"
              value={endedAt}
              onChange={e => setEndedAt(e.target.value)}
              className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30 bg-fm-surface-container-low text-fm-on-surface"
            />
          </div>
        </div>

        {/* Pausas (solo lectura) */}
        {breaks.length > 0 && (
          <div className="rounded-xl bg-fm-surface-container-low border border-fm-outline-variant/20 p-3 space-y-1">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-fm-on-surface-variant">
              Pausas (solo lectura)
            </p>
            {breaks.map((b, i) => (
              <p key={i} className="text-xs text-fm-on-surface-variant">
                {b.type === 'lunch' ? 'Almuerzo' : 'Away'}
                {': '}
                {new Date(b.started_at).toLocaleTimeString('es-SV', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {b.ended_at
                  ? ` – ${new Date(b.ended_at).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}`
                  : ' (abierta)'}
              </p>
            ))}
          </div>
        )}

        {/* Nota */}
        <div>
          <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">
            Nota (opcional)
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="Razón de la corrección…"
            className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30 bg-fm-surface-container-low text-fm-on-surface resize-none"
          />
        </div>

        {error && <p className="text-xs text-fm-error font-semibold">{error}</p>}

        {/* Acciones */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="flex-1 py-2.5 border border-fm-surface-container-high rounded-full text-sm font-bold text-fm-on-surface-variant hover:bg-fm-background disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={isPending}
            className="flex-1 py-2.5 bg-fm-primary text-white rounded-full text-sm font-bold hover:bg-fm-primary-dim disabled:opacity-60"
          >
            {isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
