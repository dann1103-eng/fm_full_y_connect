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
        className="text-xs font-semibold text-[#b31b25] hover:underline"
      >
        Eliminar cliente
      </button>
    )
  }

  return (
    <div className="glass-panel rounded-2xl p-5 border border-[#b31b25]/30 space-y-3">
      <p className="text-sm font-semibold text-[#b31b25]">¿Eliminar a {clientName}?</p>
      <p className="text-xs text-[#595c5e]">
        Esta acción es irreversible. Se eliminarán todos sus ciclos, consumos y logs asociados.
      </p>
      <div className="flex gap-3">
        <button
          onClick={() => setOpen(false)}
          disabled={loading}
          className="flex-1 py-2 text-sm border border-[#dfe3e6] rounded-xl text-[#595c5e] hover:bg-[#f5f7f9] transition-colors disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          onClick={handleDelete}
          disabled={loading}
          className="flex-1 py-2 text-sm bg-[#b31b25] text-white rounded-xl font-semibold hover:bg-[#a01820] transition-colors disabled:opacity-50"
        >
          {loading ? 'Eliminando...' : 'Sí, eliminar'}
        </button>
      </div>
    </div>
  )
}
