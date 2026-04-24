import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientId } from '@/lib/supabase/active-client'
import { QuoteStatusBadge } from '@/components/billing/StatusBadge'
import { formatCurrency, formatTaxRate } from '@/lib/domain/invoices'
import type {
  ClientFiscalSnapshot,
  EmitterSnapshot,
  Quote,
  QuoteItem,
  TermAndCondition,
} from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function PortalQuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const activeId = await getActiveClientId()
  if (!activeId) redirect('/portal/seleccionar-marca')

  const supabase = await createClient()

  const { data: quoteRow } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!quoteRow) notFound()
  const quote = quoteRow as Quote
  if (quote.client_id !== activeId) notFound()

  const { data: itemRows } = await supabase
    .from('quote_items')
    .select('*')
    .eq('quote_id', id)
    .order('sort_order')
  const items = (itemRows ?? []) as QuoteItem[]

  const clientSnap = quote.client_snapshot_json as ClientFiscalSnapshot
  const emitterSnap = quote.emitter_snapshot_json as EmitterSnapshot
  const terms = ((quote.terms_snapshot_json ?? []) as TermAndCondition[]).sort(
    (a, b) => a.order - b.order,
  )

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
        <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-6 md:p-8 space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-fm-outline-variant">
                Cotización
              </p>
              <h1 className="text-2xl font-bold text-fm-primary mt-1">{quote.quote_number}</h1>
              <div className="mt-2">
                <QuoteStatusBadge status={quote.status} />
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4 border-y border-fm-surface-container-high text-xs">
            <Field label="Cotizado a">
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
            <Field label="Fecha de emisión">{quote.issue_date}</Field>
            <Field label="Válida hasta">{quote.valid_until ?? '—'}</Field>
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
              <Row label="Subtotal" value={formatCurrency(quote.subtotal)} />
              <Row label="Descuento" value={`−${formatCurrency(quote.discount_amount)}`} />
              <Row
                label={`IVA (${formatTaxRate(quote.tax_rate)})`}
                value={quote.tax_rate === 0 ? '—' : formatCurrency(quote.tax_amount)}
              />
              <div className="h-px bg-fm-surface-container-high my-2" />
              <div className="flex items-center justify-between">
                <span className="font-semibold text-fm-on-surface">Total (USD)</span>
                <span className="text-xl font-bold text-fm-primary">
                  {formatCurrency(quote.total)}
                </span>
              </div>
            </div>
          </div>

          {quote.notes && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-fm-outline-variant mb-1.5">
                Notas
              </p>
              <p className="text-sm text-fm-on-surface whitespace-pre-wrap">{quote.notes}</p>
            </div>
          )}

          {terms.length > 0 && (
            <div className="border-t border-fm-surface-container-high pt-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-fm-outline-variant mb-2">
                Términos y condiciones
              </p>
              <ol className="space-y-1.5 list-decimal list-inside text-xs text-fm-on-surface-variant">
                {terms.map((t) => (
                  <li key={t.id} className="pl-1">
                    {t.text}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <a
            href={`/api/quotes/${quote.id}/pdf`}
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
