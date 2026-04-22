'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { markInvoicePaid } from '@/app/actions/invoices'
import { PAYMENT_METHOD_LABELS, type InvoicePaymentMethod } from '@/types/db'
import { today } from '@/lib/domain/dates'

interface MarkPaidButtonProps {
  invoiceId: string
  linkedToCycle: boolean
}

const METHOD_ORDER: InvoicePaymentMethod[] = ['transfer', 'cash', 'check', 'card', 'other']

export function MarkPaidButton({ invoiceId, linkedToCycle }: MarkPaidButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [method, setMethod] = useState<InvoicePaymentMethod>('transfer')
  const [date, setDate] = useState(today())
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await markInvoicePaid({
        id: invoiceId,
        paymentMethod: method,
        paymentDate: date,
        paymentReference: reference || null,
      })
      if ('error' in result) {
        setError(result.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        className="rounded-xl text-white font-semibold"
        style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
      >
        Marcar pagada
      </Button>
    )
  }

  return (
    <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-5 space-y-4 w-full">
      <h3 className="text-sm font-semibold text-fm-on-surface">Registrar pago</h3>

      <div className="space-y-1.5">
        <Label>Método de pago</Label>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as InvoicePaymentMethod)}
          className="w-full py-2 px-3 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl text-fm-on-surface focus:outline-none focus:border-fm-primary"
        >
          {METHOD_ORDER.map(m => (
            <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label>Fecha de pago</Label>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl bg-fm-background border-fm-surface-container-high"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Referencia (opcional)</Label>
        <Input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Nº transferencia, cheque, etc."
          className="rounded-xl bg-fm-background border-fm-surface-container-high"
        />
      </div>

      {linkedToCycle && (
        <p className="text-xs text-fm-on-surface-variant bg-fm-primary/5 border border-fm-primary/20 rounded-xl px-3 py-2">
          Esta factura está ligada a un ciclo. Al marcarla pagada, el ciclo también se marcará como pagado.
        </p>
      )}

      {error && (
        <p className="text-sm text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          onClick={handleConfirm}
          disabled={isPending}
          className="flex-1 rounded-xl text-white font-semibold"
          style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
        >
          {isPending ? 'Guardando…' : 'Confirmar pago'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(false)}
          disabled={isPending}
          className="rounded-xl"
        >
          Cancelar
        </Button>
      </div>
    </div>
  )
}
