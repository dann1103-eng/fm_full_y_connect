'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  sendQuote,
  markQuoteAccepted,
  markQuoteRejected,
  deleteQuoteDraft,
  convertQuoteToInvoice,
} from '@/app/actions/quotes'
import type { QuoteStatus } from '@/types/db'

interface QuoteActionsProps {
  quoteId: string
  status: QuoteStatus
  convertedInvoiceId: string | null
}

export function QuoteActions({ quoteId, status, convertedInvoiceId }: QuoteActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(fn: () => Promise<{ error: string } | { ok: true }>) {
    setError(null)
    startTransition(async () => {
      const r = await fn()
      if ('error' in r) { setError(r.error); return }
      router.refresh()
    })
  }

  function handleConvert() {
    setError(null)
    startTransition(async () => {
      const r = await convertQuoteToInvoice(quoteId)
      if ('error' in r) { setError(r.error); return }
      router.push(`/billing/invoices/${r.invoiceId}`)
    })
  }

  function handleDelete() {
    if (!confirm('¿Eliminar este borrador? Esta acción no se puede deshacer.')) return
    setError(null)
    startTransition(async () => {
      const r = await deleteQuoteDraft(quoteId)
      if ('error' in r) { setError(r.error); return }
      router.push('/billing/quotes')
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
            onClick={() => run(() => sendQuote(quoteId))}
            disabled={isPending}
            className="rounded-xl text-white font-semibold"
            style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
          >
            Marcar como enviada
          </Button>
          <Button onClick={handleDelete} disabled={isPending} variant="outline" className="rounded-xl text-fm-error border-fm-error/30 hover:bg-fm-error/5">
            Eliminar borrador
          </Button>
        </div>
      )}

      {status === 'sent' && (
        <div className="flex gap-2 flex-wrap">
          <Button
            onClick={() => run(() => markQuoteAccepted(quoteId))}
            disabled={isPending}
            className="rounded-xl text-white font-semibold"
            style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
          >
            Marcar aceptada
          </Button>
          <Button
            onClick={() => run(() => markQuoteRejected(quoteId))}
            disabled={isPending}
            variant="outline"
            className="rounded-xl text-fm-error border-fm-error/30 hover:bg-fm-error/5"
          >
            Marcar rechazada
          </Button>
        </div>
      )}

      {status === 'accepted' && !convertedInvoiceId && (
        <Button
          onClick={handleConvert}
          disabled={isPending}
          className="rounded-xl text-white font-semibold w-full"
          style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
        >
          Convertir a factura
        </Button>
      )}

      {convertedInvoiceId && (
        <div className="bg-fm-primary/10 border border-fm-primary/30 rounded-xl px-3 py-2 text-sm text-fm-primary font-medium text-center">
          Esta cotización ya fue facturada
        </div>
      )}
    </div>
  )
}
