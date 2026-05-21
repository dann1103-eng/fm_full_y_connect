import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { getOperatorClientIds } from '@/lib/auth/operator-scope'
import { TopNav } from '@/components/layout/TopNav'
import { ClientForm } from '@/components/clients/ClientForm'
import { ClientsTable } from '@/components/clients/ClientsTable'
import type { ClientWithPlan } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function ClientsPage() {
  const supabase = await createClient()

  const ctx = await getEffectiveUser()
  if (!ctx) redirect('/login')
  const role = ctx.appUser.role
  const isOperator = role === 'operator'
  const canCreate = role === 'admin' || role === 'supervisor'

  let clients: ClientWithPlan[] | null = null
  if (isOperator) {
    const allowedIds = await getOperatorClientIds(ctx.appUser.id)
    if (allowedIds.length === 0) {
      clients = []
    } else {
      const { data } = await supabase
        .from('clients')
        .select('*, plan:plans(*)')
        .in('id', allowedIds)
        .order('name')
      clients = (data ?? []) as ClientWithPlan[]
    }
  } else {
    const { data } = await supabase
      .from('clients')
      .select('*, plan:plans(*)')
      .order('name')
    clients = (data ?? []) as ClientWithPlan[]
  }

  const { data: plans } = await supabase
    .from('plans')
    .select('id, name, price_usd, unified_content_limit, billing_period')
    .eq('active', true)

  return (
    <div className="flex flex-col min-h-full">
      <TopNav title="Clientes" />

      <div className="flex-1 p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-fm-on-surface-variant">
            {clients?.length ?? 0} cliente{clients?.length !== 1 ? 's' : ''} registrado{clients?.length !== 1 ? 's' : ''}
          </p>
          {canCreate && <ClientForm plans={plans ?? []} />}
        </div>

        <ClientsTable clients={clients ?? []} />
      </div>
    </div>
  )
}
