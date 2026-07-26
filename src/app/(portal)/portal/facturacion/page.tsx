import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientId } from '@/lib/supabase/active-client'
import { requirePortalCapability } from '@/lib/auth/portal-permissions'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { InvoiceStatusBadge, QuoteStatusBadge } from '@/components/billing/StatusBadge'
import { N1coPayButton } from '@/components/billing/N1coPayModal'
import type { InvoiceStatus, QuoteStatus } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function PortalFacturacionPage() {
  await requirePortalCapability('billing')
  const activeId = await getActiveClientId()
  if (!activeId) redirect('/login')

  const supabase = await createClient()

  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, issue_date, due_date, total, currency, n1co_payment_link_url, payment_provider')
    .eq('client_id', activeId)
    .order('issue_date', { ascending: false })

  const { data: quotes } = await supabase
    .from('quotes')
    .select('id, quote_number, status, issue_date, valid_until, total, currency')
    .eq('client_id', activeId)
    .order('issue_date', { ascending: false })

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-fm-on-surface mb-1">Facturación</h1>
        <p className="text-sm text-fm-on-surface-variant">
          Historial de facturas y cotizaciones de tu cuenta.
        </p>
      </div>

      {/* Facturas */}
      <section className="glass-panel p-5">
        <h2 className="text-base font-semibold text-fm-on-surface mb-4">Facturas</h2>
        {!invoices?.length ? (
          <p className="text-sm text-fm-on-surface-variant">Sin facturas registradas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fm-on-surface-variant border-b border-fm-outline-variant/20">
                  <th className="pb-2 font-medium">N°</th>
                  <th className="pb-2 font-medium">Fecha</th>
                  <th className="pb-2 font-medium">Vence</th>
                  <th className="pb-2 font-medium text-right">Total</th>
                  <th className="pb-2 font-medium">Estado</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-fm-outline-variant/10">
                {invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="hover:bg-fm-background/50 transition-colors"
                  >
                    <td className="py-2.5">
                      <Link
                        href={`/portal/facturacion/${inv.id}`}
                        className="font-semibold text-fm-primary hover:underline"
                      >
                        {inv.invoice_number}
                      </Link>
                    </td>
                    <td className="py-2.5 text-fm-on-surface-variant">
                      {inv.issue_date ? format(new Date(inv.issue_date), 'dd MMM yyyy', { locale: es }) : '—'}
                    </td>
                    <td className="py-2.5 text-fm-on-surface-variant">
                      {inv.due_date ? format(new Date(inv.due_date), 'dd MMM yyyy', { locale: es }) : '—'}
                    </td>
                    <td className="py-2.5 font-medium text-fm-on-surface text-right">
                      {inv.currency} {Number(inv.total).toFixed(2)}
                    </td>
                    <td className="py-2.5">
                      <InvoiceStatusBadge status={inv.status as InvoiceStatus} />
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {inv.status === 'issued' && inv.n1co_payment_link_url && !isLinkExpired(inv.due_date) && (
                          <N1coPayButton
                            paymentLinkUrl={inv.n1co_payment_link_url}
                            invoiceId={inv.id}
                            className="inline-flex items-center gap-1 rounded-full bg-fm-primary px-3 py-1 text-[11px] font-semibold text-white hover:bg-fm-primary/90"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>credit_card</span>
                            Pagar
                          </N1coPayButton>
                        )}
                        {inv.status === 'issued' && inv.n1co_payment_link_url && isLinkExpired(inv.due_date) && (
                          <Link
                            href={`/portal/facturacion/${inv.id}`}
                            className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-3 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-200"
                            title="Link de pago vencido — haz clic para más información"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>link_off</span>
                            Link vencido
                          </Link>
                        )}
                        <Link
                          href={`/portal/facturacion/${inv.id}`}
                          className="text-xs text-fm-on-surface-variant hover:text-fm-primary"
                          aria-label={`Ver factura ${inv.invoice_number}`}
                        >
                          <span className="material-symbols-outlined text-base align-middle">
                            chevron_right
                          </span>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Cotizaciones */}
      <section className="glass-panel p-5">
        <h2 className="text-base font-semibold text-fm-on-surface mb-4">Cotizaciones</h2>
        {!quotes?.length ? (
          <p className="text-sm text-fm-on-surface-variant">Sin cotizaciones registradas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-fm-on-surface-variant border-b border-fm-outline-variant/20">
                  <th className="pb-2 font-medium">N°</th>
                  <th className="pb-2 font-medium">Fecha</th>
                  <th className="pb-2 font-medium">Vence</th>
                  <th className="pb-2 font-medium text-right">Total</th>
                  <th className="pb-2 font-medium">Estado</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-fm-outline-variant/10">
                {quotes.map((q) => (
                  <tr
                    key={q.id}
                    className="hover:bg-fm-background/50 transition-colors"
                  >
                    <td className="py-2.5">
                      <Link
                        href={`/portal/facturacion/cotizaciones/${q.id}`}
                        className="font-semibold text-fm-primary hover:underline"
                      >
                        {q.quote_number}
                      </Link>
                    </td>
                    <td className="py-2.5 text-fm-on-surface-variant">
                      {q.issue_date ? format(new Date(q.issue_date), 'dd MMM yyyy', { locale: es }) : '—'}
                    </td>
                    <td className="py-2.5 text-fm-on-surface-variant">
                      {q.valid_until ? format(new Date(q.valid_until), 'dd MMM yyyy', { locale: es }) : '—'}
                    </td>
                    <td className="py-2.5 font-medium text-fm-on-surface text-right">
                      {q.currency} {Number(q.total).toFixed(2)}
                    </td>
                    <td className="py-2.5">
                      <QuoteStatusBadge status={q.status as QuoteStatus} />
                    </td>
                    <td className="py-2.5 text-right">
                      <Link
                        href={`/portal/facturacion/cotizaciones/${q.id}`}
                        className="text-xs text-fm-on-surface-variant hover:text-fm-primary"
                        aria-label={`Ver cotización ${q.quote_number}`}
                      >
                        <span className="material-symbols-outlined text-base align-middle">
                          chevron_right
                        </span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function isLinkExpired(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false
  const endOfDueDate = new Date(dueDate)
  endOfDueDate.setHours(23, 59, 59, 999)
  return endOfDueDate < new Date()
}
