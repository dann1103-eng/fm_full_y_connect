'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { TargetPeriod } from '@/lib/domain/matrix'
import { useTargetPeriods } from './useTargetPeriods'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  clientId: string
  /** Período de la matriz original: no se ofrece como destino. */
  sourcePeriodStart: string
  busy: boolean
  /** Duplica hacia el período; devuelve el mensaje de error o null si salió bien (el editor navega). */
  onDuplicate: (period: TargetPeriod) => Promise<string | null>
}

export function DuplicateMatrixDialog({ open, onOpenChange, ...bodyProps }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && bodyProps.busy) return; onOpenChange(v) }}>
      <DialogContent className="sm:max-w-md rounded-2xl p-0 gap-0 border border-fm-outline-variant/20">
        {/* El cuerpo solo existe con el diálogo abierto: cada apertura recarga los períodos y limpia el error. */}
        <DuplicateBody {...bodyProps} />
      </DialogContent>
    </Dialog>
  )
}

function DuplicateBody({ clientId, sourcePeriodStart, busy, onDuplicate }: Omit<Props, 'open' | 'onOpenChange'>) {
  const { loading, periods, existing, error: loadError, retry } = useTargetPeriods(clientId)
  const [error, setError] = useState<string | null>(null)
  const targets = periods.filter((p) => p.periodStart !== sourcePeriodStart)

  async function pick(p: TargetPeriod) {
    setError(null)
    setError(await onDuplicate(p))
  }

  return (
    <>
      <DialogHeader className="px-6 pt-6 pb-4 border-b border-fm-outline-variant/10">
        <DialogTitle className="text-lg font-semibold text-fm-on-surface">Duplicar matriz</DialogTitle>
      </DialogHeader>
      <div className="px-6 py-4 space-y-2">
        <p className="text-sm text-fm-on-surface-variant">Elige el período destino. Se copian temas, notas y piezas con las fechas corridas.</p>
        {loading && <p className="text-xs text-fm-on-surface-variant">Cargando períodos…</p>}
        {loadError && (
          <div className="flex items-center gap-2 text-xs text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">
            <span className="flex-1">{loadError}</span>
            <button type="button" onClick={retry} className="font-semibold underline">Reintentar</button>
          </div>
        )}
        {!loading && !loadError && targets.length === 0 && (
          <p className="text-sm text-fm-on-surface-variant">No hay períodos disponibles para duplicar.</p>
        )}
        {targets.map((p) => {
          const exists = !!existing[p.periodStart]
          return (
            <button key={p.periodStart} type="button" disabled={exists || busy} onClick={() => void pick(p)}
              className="w-full text-left rounded-xl border border-fm-surface-container-high px-3 py-2 text-sm text-fm-on-surface hover:bg-fm-surface-container-low disabled:opacity-50">
              {p.label}{exists && <span className="text-[11px] text-fm-on-surface-variant"> · ya tiene matriz</span>}
            </button>
          )
        })}
        {error && (
          <p role="alert" className="text-xs text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">{error}</p>
        )}
      </div>
    </>
  )
}
