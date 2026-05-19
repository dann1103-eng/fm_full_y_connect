'use client'

import { useState, useTransition } from 'react'
import { pauseClient } from '@/app/actions/renewals'

interface Props {
  clientId: string
  cycleId: string
  clientName: string
}

/**
 * Botón discreto en el header del perfil para pausar al cliente (solo admin).
 * Replica el patrón de `DeleteClientButton`: collapsed → panel de confirmación
 * 2-tap. Llama `pauseClient(clientId, cycleId)` que archiva el ciclo y marca
 * al cliente como `paused`. Posteriormente `ReactivatePanel` permite reactivar.
 */
export function PauseClientButton({ clientId, cycleId, clientName }: Props) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handlePause() {
    setError(null)
    startTransition(async () => {
      const res = await pauseClient(clientId, cycleId)
      if ('error' in res) {
        setError(res.error ?? 'No se pudo pausar al cliente.')
      } else {
        // Al éxito el server hace revalidatePath y la página re-renderiza.
        // Reset local por si el componente queda montado.
        setOpen(false)
        setConfirm(false)
      }
    })
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-amber-700 hover:underline"
      >
        Pausar cliente
      </button>
    )
  }

  return (
    <div className="glass-panel rounded-2xl p-5 border border-amber-300/50 space-y-3 min-w-[280px]">
      <p className="text-sm font-semibold text-amber-800">Pausar a {clientName}</p>
      <p className="text-xs text-fm-on-surface-variant">
        El ciclo actual se archivará y el cliente quedará en estado{' '}
        <strong>Pausado</strong>. Podrás reactivarlo desde su perfil cuando vuelva.
      </p>
      {error && <p className="text-xs text-fm-error font-semibold">{error}</p>}

      {!confirm ? (
        <div className="flex gap-3">
          <button
            onClick={() => { setOpen(false); setError(null) }}
            disabled={isPending}
            className="flex-1 py-2 text-sm border border-fm-surface-container-high rounded-xl text-fm-on-surface-variant hover:bg-fm-background transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => setConfirm(true)}
            disabled={isPending}
            className="flex-1 py-2 text-sm bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600 transition-colors disabled:opacity-50"
          >
            Sí, pausar
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-center text-fm-on-surface-variant">
            ¿Confirmas pausar a <strong>{clientName}</strong>?
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => { setConfirm(false); setError(null) }}
              disabled={isPending}
              className="flex-1 py-2 text-sm border border-fm-surface-container-high rounded-xl text-fm-on-surface-variant hover:bg-fm-background transition-colors disabled:opacity-50"
            >
              Atrás
            </button>
            <button
              onClick={handlePause}
              disabled={isPending}
              className="flex-1 py-2 text-sm bg-amber-600 text-white rounded-xl font-semibold hover:bg-amber-700 transition-colors disabled:opacity-50"
            >
              {isPending ? 'Pausando…' : 'Confirmar pausa'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
