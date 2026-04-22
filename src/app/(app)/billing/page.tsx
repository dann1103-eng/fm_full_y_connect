import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { formatCurrency } from '@/lib/domain/invoices'
import { InvoiceStatusBadge, QuoteStatusBadge } from '@/components/billing/StatusBadge'

export const dynamic = 'force-dynamic'

export default async function BillingDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: appUser } = await supabase.from('users').select('role').eq('id', user.id).single()
  const role = appUser?.role
  if (role !== 'admin' && role !== 'supervisor') redirect('/')

  const [
    { count: draftCount },
    { count: issuedCount },
    { count: paidCount },
    { data: recentInvoices },
    { data: recentQuotes },
    { data: outstanding },
  ] = await Promise.all([
    supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
    supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('status', 'issued'),
    supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('status', 'paid'),
    supabase.from('invoices').select('id, invoice_number, issue_date, total, status, client_snapshot_json').order('created_at', { ascending: false }).limit(5),
    supabase.from('quotes').select('id, quote_number, issue_date, total, status, client_snapshot_json').order('created_at', { ascending: false }).limit(5),
    supabase.from('invoices').select('total').eq('status', 'issued'),
  ])

  const outstandingTotal = (outstanding ?? []).reduce((sum, inv) => sum + Number(inv.total || 0), 0)

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Facturación" />

      <div className="flex-1 p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-2">
            <Link
              href="/billing/invoices/new"
              className="text-sm font-semibold text-white px-4 py-2 rounded-xl"
              style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
            >
              + Nueva factura
            </Link>
            <Link
              href="/billing/quotes/new"
              className="text-sm font-semibold text-fm-primary bg-fm-primary/10 border border-fm-primary/30 px-4 py-2 rounded-xl hover:bg-fm-primary/15"
            >
              + Nueva cotización
            </Link>
          </div>
          {role === 'admin' && (
            <Link
              href="/billing/settings"
              className="text-sm font-medium text-fm-on-surface-variant hover:text-fm-primary underline-offset-2 hover:underline"
            >
              Configurar emisor · T&C · métodos de pago →
            </Link>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Borradores" value={draftCount ?? 0} />
          <StatCard label="Emitidas" value={issuedCount ?? 0} />
          <StatCard label="Pagadas" value={paidCount ?? 0} />
          <StatCard label="Por cobrar" value={formatCurrency(outstandingTotal)} tone="accent" />
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          <RecentList
            title="Últimas facturas"
            href="/billing/invoices"
            empty="Sin facturas aún."
            items={(recentInvoices ?? []).map(inv => ({
              id: inv.id,
              href: `/billing/invoices/${inv.id}`,
              number: inv.invoice_number,
              clientName: (inv.client_snapshot_json as { name?: string })?.name ?? '—',
              date: inv.issue_date,
              total: inv.total,
              badge: <InvoiceStatusBadge status={inv.status} />,
            }))}
          />
          <RecentList
            title="Últimas cotizaciones"
            href="/billing/quotes"
            empty="Sin cotizaciones aún."
            items={(recentQuotes ?? []).map(q => ({
              id: q.id,
              href: `/billing/quotes/${q.id}`,
              number: q.quote_number,
              clientName: (q.client_snapshot_json as { name?: string })?.name ?? '—',
              date: q.issue_date,
              total: q.total,
              badge: <QuoteStatusBadge status={q.status} />,
            }))}
          />
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: 'accent' }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone === 'accent' ? 'bg-fm-primary/10 border-fm-primary/30' : 'bg-fm-surface-container-lowest border-fm-outline-variant/20'}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${tone === 'accent' ? 'text-fm-primary' : 'text-fm-on-surface-variant'}`}>
        {label}
      </p>
      <p className={`mt-2 text-2xl font-bold ${tone === 'accent' ? 'text-fm-primary' : 'text-fm-on-surface'}`}>
        {value}
      </p>
    </div>
  )
}

interface RecentItem {
  id: string
  href: string
  number: string
  clientName: string
  date: string
  total: number
  badge: React.ReactNode
}

function RecentList({ title, href, items, empty }: { title: string; href: string; items: RecentItem[]; empty: string }) {
  return (
    <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-fm-on-surface">{title}</h3>
        <Link href={href} className="text-xs font-medium text-fm-primary hover:underline">Ver todas →</Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-fm-on-surface-variant py-6 text-center">{empty}</p>
      ) : (
        <ul className="divide-y divide-fm-surface-container-high">
          {items.map(it => (
            <li key={it.id}>
              <Link href={it.href} className="flex items-center gap-3 py-2.5 hover:bg-fm-background -mx-2 px-2 rounded-lg">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-fm-on-surface">{it.number}</span>
                    {it.badge}
                  </div>
                  <p className="text-xs text-fm-on-surface-variant truncate">{it.clientName} · {it.date}</p>
                </div>
                <span className="text-sm font-semibold text-fm-on-surface">{formatCurrency(it.total)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
