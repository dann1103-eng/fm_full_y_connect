'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { adjustContentPoolCredits } from '@/app/actions/credits'

/**
 * Ajuste manual del paquete on-demand de un cliente (solo admin): regalar contenidos, cortesías o
 * corregir un error. El saldo que el cliente PAGA se factura (catálogo "Paquete on-demand" del
 * formulario de facturas) y se activa al cobrarse; esto no genera factura.
 */
export function PoolCreditsAdjust({ clientId, remaining }: { clientId: string; remaining: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'add' | 'remove'>('add')
  const [qty, setQty] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function close() {
    setOpen(false)
    setQty('')
    setNotes('')
    setError(null)
    setMode('add')
  }

  function submit() {
    const n = Number.parseInt(qty, 10)
    if (!Number.isInteger(n) || n <= 0) {
      setError('Escribe una cantidad entera mayor que cero.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await adjustContentPoolCredits({
        clientId,
        delta: mode === 'add' ? n : -n,
        notes: notes.trim() || null,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      close()
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-fm-primary hover:underline"
      >
        {remaining > 0 ? 'Ajustar paquete on-demand' : '+ Agregar paquete on-demand'}
      </button>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-fm-primary/20 bg-fm-primary/5 p-3 space-y-3">
      <div className="flex gap-2">
        {(['add', 'remove'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            disabled={isPending}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              mode === m
                ? 'bg-fm-primary text-white border-fm-primary'
                : 'border-fm-surface-container-high text-fm-on-surface-variant hover:bg-fm-background'
            }`}
          >
            {m === 'add' ? 'Agregar contenidos' : 'Quitar contenidos'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <input
          type="number"
          min={1}
          max={1000}
          inputMode="numeric"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="Cantidad"
          aria-label="Cantidad de contenidos"
          disabled={isPending}
          className="col-span-1 px-3 py-2 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl"
        />
        <input
          type="text"
          maxLength={300}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Motivo (opcional): cortesía, corrección…"
          aria-label="Motivo del ajuste"
          disabled={isPending}
          className="col-span-2 px-3 py-2 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl"
        />
      </div>
      {mode === 'remove' && (
        <p className="text-[11px] text-fm-on-surface-variant">
          Saldo actual: {remaining}. Se quita del más antiguo al más nuevo y nunca baja de cero.
        </p>
      )}
      {error && (
        <p className="text-xs text-fm-error font-semibold bg-fm-error/5 rounded-lg px-3 py-2 border border-fm-error/20">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={close}
          disabled={isPending}
          className="flex-1 py-1.5 text-xs border border-fm-surface-container-high rounded-xl text-fm-on-surface-variant hover:bg-fm-background disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="flex-1 py-1.5 text-xs bg-fm-primary text-white rounded-xl font-semibold hover:bg-fm-primary-dim disabled:opacity-50"
        >
          {isPending ? 'Guardando…' : 'Confirmar'}
        </button>
      </div>
    </div>
  )
}
