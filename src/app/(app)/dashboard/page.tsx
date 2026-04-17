import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { ClientCard } from '@/components/clients/ClientCard'
import { DashboardFilters } from '@/components/clients/DashboardFilters'
import type { ClientWithPlan, BillingCycle, Consumption } from '@/types/db'
import { daysUntilEnd } from '@/lib/domain/cycles'
import { computeTotals } from '@/lib/domain/consumption'
import { effectiveLimits, limitsToRecord } from '@/lib/domain/plans'

export const dynamic = 'force-dynamic'

export interface ClientDashboardItem {
  client: ClientWithPlan
  cycle: BillingCycle | null
  totals: Record<string, number>
  limits: Record<string, number>
  daysLeft: number | null
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; status?: string; q?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  // Fetch all clients with their current plan
  const { data: clients } = await supabase
    .from('clients')
    .select('*, plan:plans(*)')
    .order('name')

  if (!clients) return null

  // Filter clients
  let filtered = clients as ClientWithPlan[]
  if (params.q) {
    const q = params.q.toLowerCase()
    filtered = filtered.filter((c) => c.name.toLowerCase().includes(q))
  }
  if (params.plan) {
    filtered = filtered.filter((c) => c.current_plan_id === params.plan)
  }
  if (params.status) {
    filtered = filtered.filter((c) => c.status === params.status)
  }

  // Fetch current cycles for all clients in one query
  const clientIds = filtered.map((c) => c.id)
  const { data: cycles } = await supabase
    .from('billing_cycles')
    .select('*')
    .in('client_id', clientIds)
    .eq('status', 'current')

  const cycleMap = new Map<string, BillingCycle>()
  cycles?.forEach((cyc) => cycleMap.set(cyc.client_id, cyc))

  // Fetch consumptions for all current cycles
  const cycleIds = cycles?.map((c) => c.id) ?? []
  const { data: consumptions } = cycleIds.length
    ? await supabase
        .from('consumptions')
        .select('*')
        .in('billing_cycle_id', cycleIds)
    : { data: [] }

  const consumptionsByCycle = new Map<string, Consumption[]>()
  consumptions?.forEach((c) => {
    const arr = consumptionsByCycle.get(c.billing_cycle_id) ?? []
    arr.push(c)
    consumptionsByCycle.set(c.billing_cycle_id, arr)
  })

  // Build dashboard items
  const items: ClientDashboardItem[] = filtered.map((client) => {
    const cycle = cycleMap.get(client.id) ?? null
    const cycleCons = cycle ? (consumptionsByCycle.get(cycle.id) ?? []) : []
    const totals = computeTotals(cycleCons)
    const limits = cycle
      ? effectiveLimits(cycle.limits_snapshot_json, cycle.rollover_from_previous_json)
      : limitsToRecord(client.plan.limits_json)
    const daysLeft = cycle ? daysUntilEnd(cycle.period_end) : null

    return { client, cycle, totals, limits, daysLeft }
  })

  // KPI counts
  const activeCount = clients.filter((c) => c.status === 'active').length
  const overdueCount = clients.filter((c) => c.status === 'overdue').length
  const renewalSoonCount = items.filter(
    (i) => i.daysLeft !== null && i.daysLeft <= 7 && i.daysLeft >= 0
  ).length

  // Plans for filter dropdown
  const { data: plans } = await supabase.from('plans').select('id, name').eq('active', true)

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Dashboard" />

      <div className="flex-1 p-6 space-y-6">
        {/* KPI row */}
        <div className="grid grid-cols-3 gap-4">
          <KpiCard
            label="Clientes activos"
            value={activeCount}
            color="text-[#00675c]"
            bg="bg-[#00675c]/8"
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
              </svg>
            }
          />
          <KpiCard
            label="Morosos"
            value={overdueCount}
            color="text-[#b31b25]"
            bg="bg-[#b31b25]/8"
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
            }
          />
          <KpiCard
            label="Renuevan pronto"
            value={renewalSoonCount}
            color="text-[#7a4f00]"
            bg="bg-amber-50"
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/>
              </svg>
            }
          />
        </div>

        {/* Filters */}
        <DashboardFilters plans={plans ?? []} />

        {/* Client grid */}
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[#595c5e]">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3 text-[#abadaf]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
            <p className="font-medium">No se encontraron clientes</p>
            <p className="text-sm mt-1">Intenta con otros filtros.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {items.map((item) => (
              <ClientCard key={item.client.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function KpiCard({
  label,
  value,
  color,
  bg,
  icon,
}: {
  label: string
  value: number
  color: string
  bg: string
  icon: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#abadaf]/20 p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl ${bg} flex items-center justify-center flex-shrink-0 ${color}`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-[#2c2f31]">{value}</p>
        <p className="text-sm text-[#595c5e]">{label}</p>
      </div>
    </div>
  )
}
