import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientId } from '@/lib/supabase/active-client'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

export default async function PortalFacturacionPage() {
  const activeId = await getActiveClientId()
  if (!activeId) redirect('/portal/seleccionar-marca')

  const supabase = await createClient()

  const { data: invoices } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, issue_date, due_date, total, currency')
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
                  <th className="pb-2 font-medium">Total</th>
                  <th className="pb-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-fm-outline-variant/10">
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="py-2.5 font-medium text-fm-on-surface">{inv.invoice_number}</td>
                    <td className="py-2.5 text-fm-on-surface-variant">
                      {inv.issue_date ? format(new Date(inv.issue_date), 'dd MMM yyyy', { locale: es }) : '—'}
                    </td>
                    <td className="py-2.5 text-fm-on-surface-variant">
                      {inv.due_date ? format(new Date(inv.due_date), 'dd MMM yyyy', { locale: es }) : '—'}
                    </td>
                    <td className="py-2.5 font-medium text-fm-on-surface">
                      {inv.currency} {Number(inv.total).toFixed(2)}
                    </td>
                    <td className="py-2.5">
                      <InvoiceStatusBadge status={inv.status ?? ''} />
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
                  <th className="pb-2 font-medium">Total</th>
                  <th className="pb-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-fm-outline-variant/10">
                {quotes.map((q) => (
                  <tr key={q.id}>
                    <td className="py-2.5 font-medium text-fm-on-surface">{q.quote_number}</td>
                    <td className="py-2.5 text-fm-on-surface-variant">
                      {q.issue_date ? format(new Date(q.issue_date), 'dd MMM yyyy', { locale: es }) : '—'}
                    </td>
                    <td className="py-2.5 text-fm-on-surface-variant">
                      {q.valid_until ? format(new Date(q.valid_until), 'dd MMM yyyy', { locale: es }) : '—'}
                    </td>
                    <td className="py-2.5 font-medium text-fm-on-surface">
                      {q.currency} {Number(q.total).toFixed(2)}
                    </td>
                    <td className="py-2.5">
                      <QuoteStatusBadge status={q.status ?? ''} />
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

function InvoiceStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft:    { label: 'Borrador', className: 'bg-gray-100 text-gray-600' },
    issued:   { label: 'Emitida',  className: 'bg-blue-50 text-blue-700' },
    paid:     { label: 'Pagada',   className: 'bg-green-50 text-green-700' },
    void:     { label: 'Anulada',  className: 'bg-red-50 text-red-600' },
  }
  const s = map[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' }
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>
}

function QuoteStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    draft:    { label: 'Borrador',  className: 'bg-gray-100 text-gray-600' },
    sent:     { label: 'Enviada',   className: 'bg-blue-50 text-blue-700' },
    accepted: { label: 'Aceptada',  className: 'bg-green-50 text-green-700' },
    rejected: { label: 'Rechazada', className: 'bg-red-50 text-red-600' },
    expired:  { label: 'Vencida',   className: 'bg-amber-50 text-amber-700' },
  }
  const s = map[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' }
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>
}
