import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { InvoiceStatusBadge } from '@/components/billing/StatusBadge'
import { formatCurrency } from '@/lib/domain/invoices'
import type { InvoiceStatus, ClientFiscalSnapshot } from '@/types/db'

export const dynamic = 'force-dynamic'

interface SearchParams {
  status?: string
  q?: string
}

const STATUS_VALUES: InvoiceStatus[] = ['draft', 'issued', 'paid', 'void']

export default async function InvoicesListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: appUser } = await supabase.from('users').select('role').eq('id', user.id).single()
  const role = appUser?.role
  if (role !== 'admin') redirect('/')

  let query = supabase
    .from('invoices')
    .select('id, invoice_number, issue_date, due_date, total, status, client_snapshot_json, payment_date')
    .order('created_at', { ascending: false })

  const statusFilter = params.status && STATUS_VALUES.includes(params.status as InvoiceStatus) ? params.status as InvoiceStatus : null
  if (statusFilter) query = query.eq('status', statusFilter)

  const { data: invoices } = await query
  const filtered = params.q
    ? (invoices ?? []).filter(inv => {
        const q = params.q!.toLowerCase()
        const name = (inv.client_snapshot_json as ClientFiscalSnapshot | null)?.name?.toLowerCase() ?? ''
        return inv.invoice_number.toLowerCase().includes(q) || name.includes(q)
      })
    : invoices ?? []

  return (
    <div className="flex flex-col min-h-full">
      <TopNav title="Facturas" backHref="/billing" />

      <div className="flex-1 p-4 sm:p-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-2 flex-wrap">
            <FilterLink href="/billing/invoices" active={!statusFilter} label="Todas" />
            {STATUS_VALUES.map(s => (
              <FilterLink
                key={s}
                href={`/billing/invoices?status=${s}`}
                active={statusFilter === s}
                label={s === 'draft' ? 'Borradores' : s === 'issued' ? 'Emitidas' : s === 'paid' ? 'Pagadas' : 'Anuladas'}
              />
            ))}
          </div>
          <Link
            href="/billing/invoices/new"
            className="text-sm font-semibold text-white px-4 py-2 rounded-xl"
            style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
          >
            + Nueva factura
          </Link>
        </div>

        <form method="get" className="flex gap-2">
          {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
          <input aria-label="Buscar por número o cliente…"
            type="search"
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Buscar por número o cliente…"
            className="flex-1 py-2 px-3 text-sm bg-fm-surface-container-lowest border border-fm-surface-container-high rounded-xl text-fm-on-surface focus:outline-none focus:border-fm-primary"
          />
          <button
            type="submit"
            className="text-sm font-medium text-fm-primary bg-fm-primary/10 border border-fm-primary/30 px-4 py-2 rounded-xl hover:bg-fm-primary/15"
          >
            Buscar
          </button>
        </form>

        <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 overflow-hidden">
          {filtered.length === 0 ? (
            <p className="p-10 text-center text-sm text-fm-on-surface-variant">Sin facturas con estos criterios.</p>
          ) : (
            <>
              {/* Móvil: lista de tarjetas */}
              <ul className="sm:hidden divide-y divide-fm-surface-container-high">
                {filtered.map(inv => {
                  const snap = inv.client_snapshot_json as ClientFiscalSnapshot | null
                  return (
                    <li key={inv.id}>
                      <Link
                        href={`/billing/invoices/${inv.id}`}
                        className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-fm-background active:bg-fm-background"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-fm-on-surface">{inv.invoice_number}</span>
                            <InvoiceStatusBadge status={inv.status} />
                          </div>
                          <p className="text-xs text-fm-on-surface-variant mt-0.5 truncate">{snap?.name ?? '—'}</p>
                          <p className="text-xs text-fm-on-surface-variant mt-0.5">
                            {inv.issue_date}{inv.due_date ? ` · vence ${inv.due_date}` : ''}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-fm-on-surface tabular-nums shrink-0">{formatCurrency(inv.total)}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>

              {/* Escritorio: tabla */}
              <table className="hidden sm:table w-full text-sm">
                <thead className="text-xs font-semibold text-fm-outline-variant uppercase tracking-wider bg-fm-background">
                  <tr>
                    <th className="text-left px-4 py-3">Número</th>
                    <th className="text-left px-4 py-3">Cliente</th>
                    <th className="text-left px-4 py-3">Emitida</th>
                    <th className="text-left px-4 py-3">Vence</th>
                    <th className="text-right px-4 py-3">Total</th>
                    <th className="text-left px-4 py-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(inv => {
                    const snap = inv.client_snapshot_json as ClientFiscalSnapshot | null
                    return (
                      <tr key={inv.id} className="border-t border-fm-surface-container-high hover:bg-fm-background">
                        <td className="px-4 py-3">
                          <Link href={`/billing/invoices/${inv.id}`} className="font-semibold text-fm-on-surface hover:text-fm-primary">
                            {inv.invoice_number}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-fm-on-surface">{snap?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-fm-on-surface-variant">{inv.issue_date}</td>
                        <td className="px-4 py-3 text-fm-on-surface-variant">{inv.due_date ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-fm-on-surface">{formatCurrency(inv.total)}</td>
                        <td className="px-4 py-3"><InvoiceStatusBadge status={inv.status} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
        active
          ? 'bg-fm-primary/10 text-fm-primary border-fm-primary/30'
          : 'text-fm-on-surface-variant border-fm-surface-container-high hover:bg-fm-background'
      }`}
    >
      {label}
    </Link>
  )
}
