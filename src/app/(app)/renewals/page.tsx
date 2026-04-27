import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { RenewalRow } from '@/components/renewals/RenewalRow'
import { RenewalsFilters } from '@/components/renewals/RenewalsFilters'
import type { BillingCycle, ClientWithPlan } from '@/types/db'
import { daysUntilEnd } from '@/lib/domain/cycles'

export const dynamic = 'force-dynamic'

interface RenewalItem {
  cycle: BillingCycle
  client: ClientWithPlan
  daysLeft: number
}

export default async function RenewalsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    plan?: string
    vencimiento?: string
    pago?: string
  }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const { data: { user: authUser } } = await supabase.auth.getUser()
  const { data: appUser } = authUser
    ? await supabase.from('users').select('role').eq('id', authUser.id).single()
    : { data: null }
  const isAdmin = appUser?.role === 'admin'
  if (!isAdmin) redirect('/')

  const in3Days = new Date(new Date().getTime() + 3 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]

  // Cycles due in ≤3 days or overdue
  const { data: cycles } = await supabase
    .from('billing_cycles')
    .select('*')
    .in('status', ['current', 'pending_renewal'])
    .lte('period_end', in3Days)
    .order('period_end')

  if (!cycles || cycles.length === 0) {
    return (
      <div className="flex flex-col min-h-full">
        <TopNav title="Renovaciones" />
        <div className="flex-1 p-6">
          <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-12 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-3 text-fm-outline-variant" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
            </svg>
            <p className="text-fm-on-surface-variant font-medium">Sin renovaciones pendientes</p>
            <p className="text-sm text-fm-outline mt-1">No hay ciclos que venzan en los próximos 3 días.</p>
          </div>
        </div>
      </div>
    )
  }

  // Fetch clients for these cycles
  const clientIds = [...new Set(cycles.map((c) => c.client_id))]
  const { data: clients } = await supabase
    .from('clients')
    .select('*, plan:plans(*)')
    .in('id', clientIds)

  const clientMap = new Map<string, ClientWithPlan>()
  clients?.forEach((c) => clientMap.set(c.id, c as ClientWithPlan))

  // Plans for filter dropdown
  const { data: plans } = await supabase
    .from('plans')
    .select('id, name, limits_json, cambios_included')
    .eq('active', true)

  // Build renewal items
  let items: RenewalItem[] = cycles
    .map((cycle) => {
      const client = clientMap.get(cycle.client_id)
      if (!client) return null
      return { cycle, client, daysLeft: daysUntilEnd(cycle.period_end) }
    })
    .filter(Boolean) as RenewalItem[]

  // Apply filters
  if (params.q) {
    const q = params.q.toLowerCase()
    items = items.filter((i) => i.client.name.toLowerCase().includes(q))
  }
  if (params.plan) {
    items = items.filter((i) => i.client.current_plan_id === params.plan)
  }
  if (params.vencimiento === 'hoy') {
    items = items.filter((i) => i.daysLeft === 0)
  } else if (params.vencimiento === 'semana') {
    items = items.filter((i) => i.daysLeft >= 0 && i.daysLeft <= 7)
  } else if (params.vencimiento === 'vencido') {
    items = items.filter((i) => i.daysLeft < 0)
  }
  if (params.pago === 'paid') {
    items = items.filter((i) => i.cycle.payment_status === 'paid')
  } else if (params.pago === 'unpaid') {
    items = items.filter((i) => i.cycle.payment_status === 'unpaid')
  }

  const overdueCount = items.filter((i) => i.daysLeft < 0).length
  const dueSoonCount = items.filter((i) => i.daysLeft >= 0 && i.daysLeft <= 3).length

  return (
    <div className="flex flex-col min-h-full">
      <TopNav title="Renovaciones" />

      <div className="flex-1 p-6 space-y-5">
        {/* Summary chips */}
        <div className="flex gap-3 flex-wrap">
          {overdueCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-fm-error bg-fm-error/10 border border-fm-error/20 px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-fm-error" />
              {overdueCount} moroso{overdueCount !== 1 ? 's' : ''}
            </span>
          )}
          {dueSoonCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {dueSoonCount} vence{dueSoonCount !== 1 ? 'n' : ''} en ≤3 días
            </span>
          )}
        </div>

        {/* Filters */}
        <RenewalsFilters plans={plans ?? []} />

        {/* Renewal rows */}
        <div className="space-y-3">
          {items.length === 0 ? (
            <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-8 text-center text-sm text-fm-on-surface-variant">
              Sin resultados con los filtros actuales.
            </div>
          ) : (
            items.map((item) => (
              <RenewalRow
                key={item.cycle.id}
                cycle={item.cycle}
                client={item.client}
                daysLeft={item.daysLeft}
                isAdmin={isAdmin}
                allPlans={plans ?? []}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
