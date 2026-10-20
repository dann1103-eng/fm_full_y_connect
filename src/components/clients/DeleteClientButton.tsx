'use client'

import { useState } from 'react'
import { deleteClient, type DeleteClientBillingSummary } from '@/app/actions/deleteClient'

export function DeleteClientButton({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Si el cliente tiene facturas/cotizaciones, el servidor no borra nada hasta que se confirme
  // viendo los conteos: este estado dispara el segundo paso de confirmación.
  const [billing, setBilling] = useState<DeleteClientBillingSummary | null>(null)

  async function handleDelete() {
    setLoading(true)
    setError(null)
    try {
      const res = await deleteClient(clientId, { confirmBilling: billing !== null })
      if (res?.error) {
        setError(res.error)
        setLoading(false)
        return
      }
      if (res?.billing) {
        setBilling(res.billing)
        setLoading(false)
        return
      }
      // El server action hace redirect('/clients') al final si tuvo éxito;
      // ese redirect lanza NEXT_REDIRECT y no llegamos a esta línea en caso normal.
    } catch (err) {
      // NEXT_REDIRECT no es un error real — solo capturamos errores no redirect.
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('NEXT_REDIRECT')) {
        setError(msg)
        setLoading(false)
      }
    }
  }

  if (!open) {
    return (
      <button type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-fm-error hover:underline"
      >
        Eliminar cliente
      </button>
    )
  }

  return (
    <div className="glass-panel rounded-2xl p-5 border border-fm-error/30 space-y-3">
      <p className="text-sm font-semibold text-fm-error">¿Eliminar a {clientName}?</p>
      <p className="text-xs text-fm-on-surface-variant">
        Esta acción es irreversible. Se eliminarán todos sus ciclos, requerimientos y logs asociados.
      </p>
      {billing && (
        <div className="text-xs text-fm-error bg-fm-error/5 rounded-lg px-3 py-2 border border-fm-error/20 space-y-1">
          <p className="font-semibold">
            Este cliente tiene {billing.invoices} factura{billing.invoices === 1 ? '' : 's'}
            {billing.invoices > 0 && ` (${billing.paidInvoices} pagada${billing.paidInvoices === 1 ? '' : 's'})`}
            {' '}y {billing.quotes} cotización{billing.quotes === 1 ? '' : 'es'}.
          </p>
          <p>
            También se eliminarán de forma permanente, junto con sus créditos. La numeración de facturas
            quedará con huecos. Si necesitas conservar estos documentos, descárgalos antes de continuar.
          </p>
        </div>
      )}
      {error && (
        <p className="text-xs text-fm-error font-semibold bg-fm-error/5 rounded-lg px-3 py-2 border border-fm-error/20">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button type="button"
          onClick={() => {
            setOpen(false)
            setError(null)
            setBilling(null)
          }}
          disabled={loading}
          className="flex-1 py-2 text-sm border border-fm-surface-container-high rounded-xl text-fm-on-surface-variant hover:bg-fm-background transition-colors disabled:opacity-50"
        >
          Cancelar
        </button>
        <button type="button"
          onClick={handleDelete}
          disabled={loading}
          className="flex-1 py-2 text-sm bg-fm-error text-white rounded-xl font-semibold hover:bg-fm-error-dim transition-colors disabled:opacity-50"
        >
          {loading ? 'Eliminando...' : billing ? 'Sí, eliminar todo' : 'Sí, eliminar'}
        </button>
      </div>
    </div>
  )
}
