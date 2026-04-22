import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { InvoiceStatusBadge } from '@/components/billing/StatusBadge'
import { InvoiceActions } from '@/components/billing/InvoiceActions'
import { MarkPaidButton } from '@/components/billing/MarkPaidButton'
import { formatCurrency, formatTaxRate } from '@/lib/domain/invoices'
import type {
  ClientFiscalSnapshot,
  EmitterSnapshot,
  InvoiceItem,
  Invoice,
} from '@/types/db'
import { PAYMENT_METHOD_LABELS } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: appUser } = await supabase.from('users').select('role').eq('id', user.id).single()
  const role = appUser?.role
  if (role !== 'admin' && role !== 'supervisor') redirect('/')

  const { data: invoiceRow } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!invoiceRow) notFound()
  const invoice = invoiceRow as Invoice

  const { data: itemsRows } = await supabase
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', id)
    .order('sort_order')
  const items = (itemsRows ?? []) as InvoiceItem[]

  const clientSnap = invoice.client_snapshot_json as ClientFiscalSnapshot
  const emitterSnap = invoice.emitter_snapshot_json as EmitterSnapshot

  const isAdmin = role === 'admin'

  return (
    <div className="flex flex-col h-full">
      <TopNav title={`Factura ${invoice.invoice_number}`} />

      <div className="flex-1 p-6">
        <div className="grid grid-cols-[1fr_340px] gap-6">
          {/* Documento */}
          <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-8 space-y-6">
            <div className="flex justify-between items-start gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-fm-outline-variant">Factura</p>
                <h1 className="text-2xl font-bold text-fm-primary mt-1">{invoice.invoice_number}</h1>
                <div className="mt-2"><InvoiceStatusBadge status={invoice.status} /></div>
              </div>
              <div className="text-right text-xs text-fm-on-surface-variant">
                <p className="font-semibold text-fm-on-surface">{emitterSnap.trade_name ?? emitterSnap.legal_name}</p>
                <p>{emitterSnap.legal_name}</p>
                {emitterSnap.fiscal_address && <p className="mt-1 whitespace-pre-line">{emitterSnap.fiscal_address}</p>}
                {emitterSnap.nrc && <p className="mt-1">NRC: {emitterSnap.nrc}</p>}
                {emitterSnap.nit && <p>NIT: {emitterSnap.nit}</p>}
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4 py-4 border-y border-fm-surface-container-high text-xs">
              <Field label="Facturado a">
                <p className="font-semibold text-fm-on-surface">{clientSnap.legal_name ?? clientSnap.name}</p>
                {clientSnap.fiscal_address && <p className="text-fm-on-surface-variant mt-0.5">{clientSnap.fiscal_address}</p>}
                {clientSnap.nit && <p className="text-fm-on-surface-variant mt-0.5">NIT: {clientSnap.nit}</p>}
                {clientSnap.nrc && <p className="text-fm-on-surface-variant">NRC: {clientSnap.nrc}</p>}
              </Field>
              <Field label="Fecha de emisión">{invoice.issue_date}</Field>
              <Field label="Vencimiento">{invoice.due_date ?? '—'}</Field>
              <Field label="Método de pago">
                {invoice.payment_method ? PAYMENT_METHOD_LABELS[invoice.payment_method] : '—'}
                {invoice.payment_reference && <p className="text-[10px] text-fm-on-surface-variant mt-0.5">Ref: {invoice.payment_reference}</p>}
              </Field>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] font-semibold text-fm-outline-variant uppercase tracking-wider border-b border-fm-surface-container-high">
                  <th className="text-left py-2">Descripción</th>
                  <th className="text-right py-2 w-20">Cantidad</th>
                  <th className="text-right py-2 w-28">Precio unit.</th>
                  <th className="text-right py-2 w-28">Total línea</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id} className="border-b border-fm-surface-container-high/50">
                    <td className="py-2.5 text-fm-on-surface">{it.description}</td>
                    <td className="py-2.5 text-right text-fm-on-surface-variant">{Number(it.quantity)}</td>
                    <td className="py-2.5 text-right text-fm-on-surface-variant">{formatCurrency(it.unit_price)}</td>
                    <td className="py-2.5 text-right font-semibold text-fm-on-surface">{formatCurrency(it.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-end">
              <div className="w-72 space-y-1.5 text-sm">
                <Row label="Subtotal" value={formatCurrency(invoice.subtotal)} />
                <Row label="Descuento" value={`−${formatCurrency(invoice.discount_amount)}`} />
                <Row label={`IVA (${formatTaxRate(invoice.tax_rate)})`} value={invoice.tax_rate === 0 ? '—' : formatCurrency(invoice.tax_amount)} />
                <div className="h-px bg-fm-surface-container-high my-2" />
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-fm-on-surface">Total (USD)</span>
                  <span className="text-xl font-bold text-fm-primary">{formatCurrency(invoice.total)}</span>
                </div>
              </div>
            </div>

            {invoice.notes && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-fm-outline-variant mb-1.5">Notas</p>
                <p className="text-sm text-fm-on-surface whitespace-pre-wrap">{invoice.notes}</p>
              </div>
            )}

            {invoice.status === 'void' && invoice.void_reason && (
              <div className="bg-fm-error/5 border border-fm-error/20 rounded-xl px-3 py-2">
                <p className="text-xs font-semibold text-fm-error uppercase tracking-wider">Factura anulada</p>
                <p className="text-sm text-fm-error mt-1">{invoice.void_reason}</p>
              </div>
            )}
          </div>

          {/* Acciones */}
          <div className="space-y-4">
            <a
              href={`/api/invoices/${invoice.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-sm font-semibold text-fm-primary bg-fm-primary/10 border border-fm-primary/30 px-4 py-2.5 rounded-xl hover:bg-fm-primary/15"
            >
              Descargar PDF
            </a>

            {invoice.quote_id && (
              <Link
                href={`/billing/quotes/${invoice.quote_id}`}
                className="block text-center text-xs font-medium text-fm-on-surface-variant hover:text-fm-primary"
              >
                ← Ver cotización origen
              </Link>
            )}

            {invoice.billing_cycle_id && (
              <div className="bg-fm-primary/5 border border-fm-primary/20 rounded-xl px-3 py-2 text-xs text-fm-on-surface-variant">
                Factura ligada a un ciclo de facturación.
              </div>
            )}

            {isAdmin && invoice.status === 'issued' && (
              <MarkPaidButton invoiceId={invoice.id} linkedToCycle={!!invoice.billing_cycle_id} />
            )}

            {isAdmin && <InvoiceActions invoiceId={invoice.id} status={invoice.status} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-fm-outline-variant mb-1">{label}</p>
      <div className="text-fm-on-surface">{children}</div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-fm-on-surface-variant">{label}</span>
      <span className="font-medium text-fm-on-surface">{value}</span>
    </div>
  )
}
