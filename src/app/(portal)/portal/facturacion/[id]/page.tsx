import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientId } from '@/lib/supabase/active-client'
import { requirePortalCapability } from '@/lib/auth/portal-permissions'
import { InvoiceStatusBadge } from '@/components/billing/StatusBadge'
import { N1coPayButton } from '@/components/billing/N1coPayModal'
import { formatCurrency, formatTaxRate } from '@/lib/domain/invoices'
import type {
  ClientFiscalSnapshot,
  EmitterSnapshot,
  Invoice,
  InvoiceItem,
} from '@/types/db'
import { PAYMENT_METHOD_LABELS } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function PortalInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  await requirePortalCapability('billing')
  const activeId = await getActiveClientId()
  if (!activeId) redirect('/login')

  const supabase = await createClient()

  const { data: invoiceRow } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!invoiceRow) notFound()
  const invoice = invoiceRow as Invoice
  if (invoice.client_id !== activeId) notFound()

  const { data: itemRows } = await supabase
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', id)
    .order('sort_order')
  const items = (itemRows ?? []) as InvoiceItem[]

  const clientSnap = invoice.client_snapshot_json as ClientFiscalSnapshot
  const emitterSnap = invoice.emitter_snapshot_json as EmitterSnapshot

  return (
    <div className="p-6">
      <nav className="mb-4 text-sm">
        <Link
          href="/portal/facturacion"
          className="inline-flex items-center gap-1 text-fm-on-surface-variant hover:text-fm-primary"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Facturación
        </Link>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Documento */}
        <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-6 md:p-8 space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-fm-outline-variant">
                Factura
              </p>
              <h1 className="text-2xl font-bold text-fm-primary mt-1">{invoice.invoice_number}</h1>
              <div className="mt-2">
                <InvoiceStatusBadge status={invoice.status} />
              </div>
            </div>
            <div className="text-left md:text-right text-xs text-fm-on-surface-variant">
              <p className="font-semibold text-fm-on-surface">
                {emitterSnap.trade_name ?? emitterSnap.legal_name}
              </p>
              <p>{emitterSnap.legal_name}</p>
              {emitterSnap.fiscal_address && (
                <p className="mt-1 whitespace-pre-line">{emitterSnap.fiscal_address}</p>
              )}
              {emitterSnap.nrc && <p className="mt-1">NRC: {emitterSnap.nrc}</p>}
              {emitterSnap.nit && <p>NIT: {emitterSnap.nit}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4 border-y border-fm-surface-container-high text-xs">
            <Field label="Facturado a">
              <p className="font-semibold text-fm-on-surface">
                {clientSnap.legal_name ?? clientSnap.name}
              </p>
              {clientSnap.fiscal_address && (
                <p className="text-fm-on-surface-variant mt-0.5">{clientSnap.fiscal_address}</p>
              )}
              {clientSnap.nit && (
                <p className="text-fm-on-surface-variant mt-0.5">NIT: {clientSnap.nit}</p>
              )}
              {clientSnap.nrc && (
                <p className="text-fm-on-surface-variant">NRC: {clientSnap.nrc}</p>
              )}
            </Field>
            <Field label="Fecha de emisión">{invoice.issue_date}</Field>
            <Field label="Vencimiento">{invoice.due_date ?? '—'}</Field>
            <Field label="Método de pago">
              {invoice.payment_method ? PAYMENT_METHOD_LABELS[invoice.payment_method] : '—'}
              {invoice.payment_reference && (
                <p className="text-[10px] text-fm-on-surface-variant mt-0.5">
                  Ref: {invoice.payment_reference}
                </p>
              )}
            </Field>
          </div>

          <div className="overflow-x-auto">
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
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-fm-surface-container-high/50">
                    <td className="py-2.5 text-fm-on-surface">{it.description}</td>
                    <td className="py-2.5 text-right text-fm-on-surface-variant">
                      {Number(it.quantity)}
                    </td>
                    <td className="py-2.5 text-right text-fm-on-surface-variant">
                      {formatCurrency(it.unit_price)}
                    </td>
                    <td className="py-2.5 text-right font-semibold text-fm-on-surface">
                      {formatCurrency(it.line_total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <div className="w-full md:w-72 space-y-1.5 text-sm">
              <Row label="Subtotal" value={formatCurrency(invoice.subtotal)} />
              <Row label="Descuento" value={`−${formatCurrency(invoice.discount_amount)}`} />
              <Row
                label={`IVA (${formatTaxRate(invoice.tax_rate)})`}
                value={invoice.tax_rate === 0 ? '—' : formatCurrency(invoice.tax_amount)}
              />
              <div className="h-px bg-fm-surface-container-high my-2" />
              <div className="flex items-center justify-between">
                <span className="font-semibold text-fm-on-surface">Total (USD)</span>
                <span className="text-xl font-bold text-fm-primary">
                  {formatCurrency(invoice.total)}
                </span>
              </div>
            </div>
          </div>

          {invoice.notes && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-fm-outline-variant mb-1.5">
                Notas
              </p>
              <p className="text-sm text-fm-on-surface whitespace-pre-wrap">{invoice.notes}</p>
            </div>
          )}

          {invoice.status === 'void' && invoice.void_reason && (
            <div className="bg-fm-error/5 border border-fm-error/20 rounded-xl px-3 py-2">
              <p className="text-xs font-semibold text-fm-error uppercase tracking-wider">
                Factura anulada
              </p>
              <p className="text-sm text-fm-error mt-1">{invoice.void_reason}</p>
            </div>
          )}
        </div>

        {/* Panel lateral — acciones del cliente */}
        <div className="space-y-4">
          {invoice.status === 'issued' && invoice.n1co_payment_link_url && !isLinkExpired(invoice.due_date) && (
            <div className="bg-fm-surface-container-lowest rounded-2xl border-2 border-fm-primary/30 p-4 space-y-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-fm-outline-variant">
                  Total a pagar
                </p>
                <p className="text-2xl font-bold text-fm-primary mt-0.5">
                  {formatCurrency(invoice.total)}
                </p>
              </div>
              <N1coPayButton
                paymentLinkUrl={invoice.n1co_payment_link_url}
                invoiceId={invoice.id}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-fm-primary text-white text-sm font-semibold py-2.5 hover:bg-fm-primary/90 transition-colors"
              >
                <span className="material-symbols-outlined text-base">credit_card</span>
                Pagar ahora
              </N1coPayButton>
              <p className="text-[10px] text-fm-outline text-center">
                Pago seguro · n1co · Tu tarjeta no pasa por nuestros servidores
              </p>
            </div>
          )}

          {invoice.status === 'issued' && invoice.n1co_payment_link_url && isLinkExpired(invoice.due_date) && (
            <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-amber-600 text-xl mt-0.5">link_off</span>
                <div>
                  <p className="text-sm font-semibold text-amber-800">Link de pago vencido</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    El enlace de pago de esta factura ya no está disponible. Comunícate con tu agencia para que generen uno nuevo.
                  </p>
                </div>
              </div>
              <div className="border-t border-amber-200 pt-3 space-y-1.5 text-xs text-amber-800">
                {emitterSnap.phone && (
                  <a
                    href={`tel:${emitterSnap.phone}`}
                    className="flex items-center gap-1.5 hover:text-amber-900 font-medium"
                  >
                    <span className="material-symbols-outlined text-sm">phone</span>
                    {emitterSnap.phone}
                  </a>
                )}
                {emitterSnap.email && (
                  <a
                    href={`mailto:${emitterSnap.email}?subject=Solicitud de link de pago · ${invoice.invoice_number}`}
                    className="flex items-center gap-1.5 hover:text-amber-900 font-medium"
                  >
                    <span className="material-symbols-outlined text-sm">mail</span>
                    {emitterSnap.email}
                  </a>
                )}
              </div>
            </div>
          )}

          {invoice.status === 'issued' && !invoice.n1co_payment_link_url && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl px-3 py-3 text-xs text-amber-800">
              <p className="font-semibold mb-0.5">Pendiente de link de pago</p>
              <p>Tu agencia generará el link de pago en breve.</p>
            </div>
          )}

          <a
            href={`/api/invoices/${invoice.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-sm font-semibold text-fm-primary bg-fm-primary/10 border border-fm-primary/30 px-4 py-2.5 rounded-xl hover:bg-fm-primary/15"
          >
            <span className="material-symbols-outlined text-base align-middle mr-1">
              download
            </span>
            Descargar PDF
          </a>
        </div>
      </div>
    </div>
  )
}

/**
 * Devuelve true si el due_date de la factura ya pasó (el link n1co ha expirado).
 * Facturas sin due_date usan links de 1 año → no se consideran vencidas aquí.
 */
function isLinkExpired(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false
  const endOfDueDate = new Date(dueDate)
  endOfDueDate.setHours(23, 59, 59, 999)
  return endOfDueDate < new Date()
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-fm-outline-variant mb-1">
        {label}
      </p>
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
