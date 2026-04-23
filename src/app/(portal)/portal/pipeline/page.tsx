import { createClient } from '@/lib/supabase/server'
import { getActiveClientId } from '@/lib/supabase/active-client'
import { redirect } from 'next/navigation'
import { ClientPipelineBoard } from '@/components/portal/ClientPipelineBoard'
import { clientPhaseOf, PHASES } from '@/lib/domain/pipeline'
import type { ClientPhase } from '@/lib/domain/pipeline'
import type { Phase } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function PortalPipelinePage() {
  const clientId = await getActiveClientId()
  if (!clientId) redirect('/portal/seleccionar-marca')

  const supabase = await createClient()

  // Get current billing cycle
  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('client_id', clientId)
    .eq('status', 'current')
    .maybeSingle()

  if (!cycle) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-fm-on-surface mb-6">Pipeline</h1>
        <p className="text-sm text-fm-on-surface-variant">No tienes un ciclo de facturación activo actualmente.</p>
      </div>
    )
  }

  // IMPORTANT: requirements do NOT have client_id — they have billing_cycle_id
  // So we query requirements for this cycle
  type ReqRow = {
    id: string
    title: string
    notes: string | null
    deadline: string | null
    phase: string
    content_type: string
  }

  const { data } = await supabase
    .from('requirements')
    .select('id, title, notes, deadline, phase, content_type')
    .eq('billing_cycle_id', cycle.id)
    .eq('voided', false)
    .neq('content_type', 'produccion') // produccion doesn't have phases
    .order('registered_at', { ascending: true })
  const items: ReqRow[] = (data ?? []) as ReqRow[]

  // Group by client phase
  type GroupedItem = { id: string; title: string; notes: string | null; deadline: string | null }
  const groups: Record<ClientPhase, GroupedItem[]> = {
    diseno: [],
    revision_cliente: [],
    aprobado: [],
    pendiente_publicar: [],
    publicado: [],
  }

  for (const item of items) {
    if (!PHASES.includes(item.phase as Phase)) continue
    const cp = clientPhaseOf(item.phase as Phase)
    if (cp) groups[cp].push({ id: item.id, title: item.title, notes: item.notes, deadline: item.deadline })
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-fm-on-surface mb-6">Pipeline</h1>
      <ClientPipelineBoard groups={groups} />
    </div>
  )
}
