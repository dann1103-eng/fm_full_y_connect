import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientId } from '@/lib/supabase/active-client'
import { ClientEmpresaForm } from '@/components/portal/ClientEmpresaForm'
import type { BillingCycle, ClientWithPlan } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function PortalEmpresaPage() {
  const activeId = await getActiveClientId()
  if (!activeId) redirect('/portal/seleccionar-marca')

  const supabase = await createClient()

  const { data: clientRaw } = await supabase
    .from('clients')
    .select('*, plan:plans(*)')
    .eq('id', activeId)
    .single()

  if (!clientRaw) {
    return <div className="p-6 text-sm text-fm-error">No se encontró la empresa.</div>
  }

  const client = clientRaw as ClientWithPlan

  const { data: cycleRaw } = await supabase
    .from('billing_cycles')
    .select('id, period_start, period_end, cambios_packages_json, extra_content_json, status')
    .eq('client_id', activeId)
    .eq('status', 'current')
    .maybeSingle()

  const cycle = cycleRaw as Pick<
    BillingCycle,
    'id' | 'period_start' | 'period_end' | 'cambios_packages_json' | 'extra_content_json' | 'status'
  > | null

  return <ClientEmpresaForm client={client} cycle={cycle} />
}
