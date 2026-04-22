'use client'

import { useState } from 'react'
import { deleteClient } from '@/app/actions/deleteClient'

export function DeleteClientButton({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    setLoading(true)
    await deleteClient(clientId)
  }

  if (!open) {
    return (
      <button
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
      <div className="flex gap-3">
        <button
          onClick={() => setOpen(false)}
          disabled={loading}
          className="flex-1 py-2 text-sm border border-fm-surface-container-high rounded-xl text-fm-on-surface-variant hover:bg-fm-background transition-colors disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="flex-1 py-2 text-sm bg-fm-error text-white rounded-xl font-semibold hover:bg-fm-error-dim transition-colors disabled:opacity-50"
        >
          {loading ? 'Eliminando...' : 'Sí, eliminar'}
        </button>
      </div>
    </div>
  )
}
