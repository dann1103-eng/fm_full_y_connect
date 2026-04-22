import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { ClientForm } from '@/components/clients/ClientForm'
import { ClientsTable } from '@/components/clients/ClientsTable'
import type { ClientWithPlan } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function ClientsPage() {
  const supabase = await createClient()

  const { data: authUser } = await supabase.auth.getUser()
  const { data: appUser } = authUser.user
    ? await supabase.from('users').select('role').eq('id', authUser.user.id).single()
    : { data: null }
  const canCreate = appUser?.role === 'admin' || appUser?.role === 'supervisor'

  const { data: clients } = await supabase
    .from('clients')
    .select('*, plan:plans(*)')
    .order('name')

  const { data: plans } = await supabase
    .from('plans')
    .select('id, name, price_usd, unified_content_limit')
    .eq('active', true)

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Clientes" />

      <div className="flex-1 p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-fm-on-surface-variant">
            {clients?.length ?? 0} cliente{clients?.length !== 1 ? 's' : ''} registrado{clients?.length !== 1 ? 's' : ''}
          </p>
          {canCreate && <ClientForm plans={plans ?? []} />}
        </div>

        <ClientsTable clients={(clients ?? []) as ClientWithPlan[]} />
      </div>
    </div>
  )
}
