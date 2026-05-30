import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { QuoteStatusBadge } from '@/components/billing/StatusBadge'
import { formatCurrency } from '@/lib/domain/invoices'
import type { QuoteStatus, ClientFiscalSnapshot } from '@/types/db'

export const dynamic = 'force-dynamic'

const STATUS_VALUES: QuoteStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'expired']

export default async function QuotesListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: appUser } = await supabase.from('users').select('role, can_quote').eq('id', user.id).single()
  const role = appUser?.role
  const canQuote = appUser?.can_quote ?? false
  if (role !== 'admin' && !canQuote) redirect('/')

  let query = supabase
    .from('quotes')
    .select('id, quote_number, issue_date, valid_until, total, status, client_id, client_snapshot_json, converted_invoice_id')
    .order('created_at', { ascending: false })

  const statusFilter = params.status && STATUS_VALUES.includes(params.status as QuoteStatus) ? params.status as QuoteStatus : null
  if (statusFilter) query = query.eq('status', statusFilter)

  const { data: quotes } = await query
  const filtered = params.q
    ? (quotes ?? []).filter(q => {
        const qq = params.q!.toLowerCase()
        const name = (q.client_snapshot_json as ClientFiscalSnapshot | null)?.name?.toLowerCase() ?? ''
        return q.quote_number.toLowerCase().includes(qq) || name.includes(qq)
      })
    : quotes ?? []

  return (
    <div className="flex flex-col min-h-full">
      <TopNav title="Cotizaciones" backHref="/billing" />

      <div className="flex-1 p-4 sm:p-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-2 flex-wrap">
            <FilterLink href="/billing/quotes" active={!statusFilter} label="Todas" />
            {STATUS_VALUES.map(s => (
              <FilterLink
                key={s}
                href={`/billing/quotes?status=${s}`}
                active={statusFilter === s}
                label={s === 'draft' ? 'Borradores' : s === 'sent' ? 'Enviadas' : s === 'accepted' ? 'Aceptadas' : s === 'rejected' ? 'Rechazadas' : 'Expiradas'}
              />
            ))}
          </div>
          <Link
            href="/billing/quotes/new"
            className="text-sm font-semibold text-white px-4 py-2 rounded-xl"
            style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
          >
            + Nueva cotización
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
            <p className="p-10 text-center text-sm text-fm-on-surface-variant">Sin cotizaciones con estos criterios.</p>
          ) : (
            <>
              {/* Móvil: lista de tarjetas */}
              <ul className="sm:hidden divide-y divide-fm-surface-container-high">
                {filtered.map(q => {
                  const snap = q.client_snapshot_json as ClientFiscalSnapshot | null
                  return (
                    <li key={q.id}>
                      <Link
                        href={`/billing/quotes/${q.id}`}
                        className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-fm-background active:bg-fm-background"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm text-fm-on-surface">{q.quote_number}</span>
                            <QuoteStatusBadge status={q.status} />
                            {q.converted_invoice_id && (
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-fm-primary bg-fm-primary/10 px-1.5 py-0.5 rounded-full">
                                Facturada
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            <p className="text-xs text-fm-on-surface-variant truncate">{snap?.name ?? '—'}</p>
                            {!q.client_id && (
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                                Prospecto
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-fm-on-surface-variant mt-0.5">
                            {q.issue_date}{q.valid_until ? ` · válida hasta ${q.valid_until}` : ''}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-fm-on-surface tabular-nums shrink-0">{formatCurrency(q.total)}</span>
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
                    <th className="text-left px-4 py-3">Válida hasta</th>
                    <th className="text-right px-4 py-3">Total</th>
                    <th className="text-left px-4 py-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(q => {
                    const snap = q.client_snapshot_json as ClientFiscalSnapshot | null
                    return (
                      <tr key={q.id} className="border-t border-fm-surface-container-high hover:bg-fm-background">
                        <td className="px-4 py-3">
                          <Link href={`/billing/quotes/${q.id}`} className="font-semibold text-fm-on-surface hover:text-fm-primary">
                            {q.quote_number}
                          </Link>
                          {q.converted_invoice_id && (
                            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-fm-primary bg-fm-primary/10 px-1.5 py-0.5 rounded-full">
                              Facturada
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-fm-on-surface">
                          {snap?.name ?? '—'}
                          {!q.client_id && (
                            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
                              Prospecto
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-fm-on-surface-variant">{q.issue_date}</td>
                        <td className="px-4 py-3 text-fm-on-surface-variant">{q.valid_until ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-fm-on-surface">{formatCurrency(q.total)}</td>
                        <td className="px-4 py-3"><QuoteStatusBadge status={q.status} /></td>
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
