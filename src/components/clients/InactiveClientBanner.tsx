'use client'

import { useState, useTransition } from 'react'
import { reactivateClient } from '@/app/actions/renewals'

interface Props {
  clientId: string
  status: 'inactive_payment' | 'inactive_manual'
  reason: string | null
  deactivatedAt: string | null
  canReactivate: boolean
}

/**
 * Banner que se muestra en el detalle del cliente cuando está suspendido.
 * Solo admins y supervisores ven el botón de reactivar.
 */
export function InactiveClientBanner({
  clientId,
  status,
  reason,
  deactivatedAt,
  canReactivate,
}: Props) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleReactivate() {
    if (!confirm('¿Reactivar este cliente?')) return
    setError(null)
    startTransition(async () => {
      const res = await reactivateClient(clientId)
      if ('error' in res) setError(res.error ?? 'Error al reactivar')
      // Al éxito, revalidatePath en el server action refresca la página.
    })
  }

  const title =
    status === 'inactive_payment'
      ? 'Cliente suspendido por falta de pago'
      : 'Cliente desactivado'

  const dateLabel = deactivatedAt
    ? ` · desde ${new Date(deactivatedAt).toLocaleDateString('es-SV', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}`
    : ''

  return (
    <div className="rounded-[2rem] border border-fm-error/40 bg-fm-error/10 p-5 flex items-start gap-4">
      <span className="material-symbols-outlined text-fm-error text-3xl flex-shrink-0">
        block
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-extrabold text-fm-error">
          {title}
          <span className="font-medium opacity-80">{dateLabel}</span>
        </p>
        {reason && (
          <p className="text-xs text-fm-error/80 mt-1">{reason}</p>
        )}
        <p className="text-xs text-fm-on-surface-variant mt-2">
          Los requerimientos no pueden crearse mientras el cliente esté suspendido.
          {canReactivate ? ' Reactivar restaura el acceso.' : ' Contacta a un admin para reactivar.'}
        </p>
        {error && (
          <p className="text-xs text-fm-error mt-2 font-semibold">{error}</p>
        )}
      </div>
      {canReactivate && (
        <button
          onClick={handleReactivate}
          disabled={isPending}
          className="px-4 py-2 rounded-full bg-fm-error text-white text-xs font-bold hover:bg-fm-error/90 disabled:opacity-60 flex-shrink-0"
        >
          {isPending ? 'Reactivando…' : 'Reactivar'}
        </button>
      )}
    </div>
  )
}
