'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { issueInvoice, voidInvoice, deleteInvoiceDraft } from '@/app/actions/invoices'

interface InvoiceActionsProps {
  invoiceId: string
  status: 'draft' | 'issued' | 'paid' | 'void'
}

export function InvoiceActions({ invoiceId, status }: InvoiceActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showVoid, setShowVoid] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleIssue() {
    setError(null)
    startTransition(async () => {
      const result = await issueInvoice(invoiceId)
      if ('error' in result) { setError(result.error); return }
      router.refresh()
    })
  }

  function handleVoid() {
    if (!voidReason.trim()) { setError('La razón es obligatoria'); return }
    setError(null)
    startTransition(async () => {
      const result = await voidInvoice(invoiceId, voidReason.trim())
      if ('error' in result) { setError(result.error); return }
      setShowVoid(false)
      setVoidReason('')
      router.refresh()
    })
  }

  function handleDelete() {
    if (!confirm('¿Eliminar este borrador? Esta acción no se puede deshacer.')) return
    setError(null)
    startTransition(async () => {
      const result = await deleteInvoiceDraft(invoiceId)
      if ('error' in result) { setError(result.error); return }
      router.push('/billing/invoices')
    })
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">
          {error}
        </p>
      )}

      {status === 'draft' && (
        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={handleIssue}
            disabled={isPending}
            className="rounded-xl text-white font-semibold"
            style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
          >
            Emitir factura
          </Button>
          <Button onClick={handleDelete} disabled={isPending} variant="outline" className="rounded-xl text-fm-error border-fm-error/30 hover:bg-fm-error/5">
            Eliminar borrador
          </Button>
        </div>
      )}

      {(status === 'issued' || status === 'paid') && !showVoid && (
        <Button onClick={() => setShowVoid(true)} variant="outline" className="rounded-xl text-fm-error border-fm-error/30 hover:bg-fm-error/5">
          Anular factura
        </Button>
      )}

      {showVoid && (
        <div className="bg-fm-error/5 border border-fm-error/20 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-fm-error">Anular factura</p>
          <Textarea
            rows={3}
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="Razón de anulación…"
            className="rounded-xl bg-fm-surface-container-lowest border-fm-surface-container-high resize-none"
          />
          <div className="flex gap-2">
            <Button onClick={handleVoid} disabled={isPending} className="rounded-xl text-white bg-fm-error hover:bg-fm-error/90">
              Confirmar anulación
            </Button>
            <Button onClick={() => { setShowVoid(false); setVoidReason('') }} disabled={isPending} variant="outline" className="rounded-xl">
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
