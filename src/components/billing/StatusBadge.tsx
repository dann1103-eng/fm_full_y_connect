import type { InvoiceStatus, QuoteStatus } from '@/types/db'
import { INVOICE_STATUS_LABELS, QUOTE_STATUS_LABELS } from '@/types/db'

const INVOICE_STYLES: Record<InvoiceStatus, string> = {
  draft:  'bg-fm-background text-fm-on-surface-variant border-fm-surface-container-high',
  issued: 'bg-fm-primary/10 text-fm-primary border-fm-primary/30',
  paid:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  void:   'bg-fm-error/10 text-fm-error border-fm-error/30',
}

const QUOTE_STYLES: Record<QuoteStatus, string> = {
  draft:    'bg-fm-background text-fm-on-surface-variant border-fm-surface-container-high',
  sent:     'bg-fm-primary/10 text-fm-primary border-fm-primary/30',
  accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-fm-error/10 text-fm-error border-fm-error/30',
  expired:  'bg-amber-50 text-amber-700 border-amber-200',
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${INVOICE_STYLES[status]}`}>
      {INVOICE_STATUS_LABELS[status]}
    </span>
  )
}

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${QUOTE_STYLES[status]}`}>
      {QUOTE_STATUS_LABELS[status]}
    </span>
  )
}
