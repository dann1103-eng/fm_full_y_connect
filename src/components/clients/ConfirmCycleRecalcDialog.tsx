'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ConfirmCycleRecalcDialogProps {
  open: boolean
  periodStart: string
  periodEnd: string
  onDecision: (recalc: boolean) => void
  onCancel: () => void
}

export function ConfirmCycleRecalcDialog({
  open,
  periodStart,
  periodEnd,
  onDecision,
  onCancel,
}: ConfirmCycleRecalcDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogContent className="max-w-md rounded-2xl p-0 border border-fm-outline-variant/20">
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-fm-outline-variant/10">
          <DialogTitle className="text-base font-semibold text-fm-on-surface">
            ¿Recalcular el ciclo actual?
          </DialogTitle>
        </DialogHeader>
        <div className="px-6 py-4 text-sm text-fm-on-surface-variant space-y-2">
          <p>
            Detectamos que cambiaste la fecha de facturación. El ciclo actual va de{' '}
            <strong>{periodStart}</strong> a <strong>{periodEnd}</strong>.
          </p>
          <p>
            Puedes dejar el ciclo actual tal cual (solo los futuros se ajustan) o recalcularlo
            según las nuevas fechas.
          </p>
        </div>
        <div className="px-6 pb-6 flex flex-col gap-2">
          <Button
            type="button"
            onClick={() => onDecision(false)}
            variant="outline"
            className="w-full rounded-xl"
          >
            Solo cambiar fechas futuras
          </Button>
          <Button
            type="button"
            onClick={() => onDecision(true)}
            className="w-full rounded-xl text-white font-semibold"
            style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
          >
            Sí, recalcular ciclo actual
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
