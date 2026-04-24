import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientId } from '@/lib/supabase/active-client'
import { RequirementPanel } from '@/components/clients/RequirementPanel'
import { ClientPipelineBoard } from '@/components/portal/ClientPipelineBoard'
import { computeTotals } from '@/lib/domain/requirement'
import { effectiveLimits, applyContentLimitsWithOverride } from '@/lib/domain/plans'
import { daysUntilEnd } from '@/lib/domain/cycles'
import { clientPhaseOf, PHASES } from '@/lib/domain/pipeline'
import type { ClientPhase } from '@/lib/domain/pipeline'
import type {
  BillingCycle,
  ClientWithPlan,
  Phase,
  Requirement,
  RequirementCambioLog,
} from '@/types/db'

export const dynamic = 'force-dynamic'

type PipelineCardItem = { id: string; title: string; notes: string | null; deadline: string | null }

function emptyGroups(): Record<ClientPhase, PipelineCardItem[]> {
  return {
    diseno: [],
    revision_cliente: [],
    aprobado: [],
    pendiente_publicar: [],
    publicado: [],
  }
}

export default async function PortalDashboardPage() {
  const activeId = await getActiveClientId()
  if (!activeId) redirect('/portal/seleccionar-marca')

  const supabase = await createClient()

  const { data: clientRaw } = await supabase
    .from('clients')
    .select('*, plan:plans(*)')
    .eq('id', activeId)
    .single()

  if (!clientRaw) {
    return (
      <div className="p-6">
        <p className="text-sm text-fm-on-surface-variant">No se encontró el cliente.</p>
      </div>
    )
  }
  const client = clientRaw as ClientWithPlan

  const { data: currentCycle } = await supabase
    .from('billing_cycles')
    .select('*')
    .eq('client_id', activeId)
    .eq('status', 'current')
    .maybeSingle()

  const cycle = currentCycle as BillingCycle | null

  const { data: requirementsRaw } = cycle
    ? await supabase
        .from('requirements')
        .select('*')
        .eq('billing_cycle_id', cycle.id)
        .order('registered_at', { ascending: false })
    : { data: [] }
  const requirements = (requirementsRaw ?? []) as Requirement[]

  // Staff users para userMap (assignee display en RequirementPanel)
  const { data: users } = await supabase
    .from('users')
    .select('id, full_name, role, avatar_url')
    .not('role', 'eq', 'client')

  const userMap: Record<string, string> = {}
  ;(users ?? []).forEach((u) => {
    userMap[u.id] =
      u.full_name ||
      (u.role === 'admin' ? 'Admin' : u.role === 'supervisor' ? 'Supervisor' : 'Operador')
  })

  // Cambio logs del ciclo actual
  const cambioLogsMap: Record<string, RequirementCambioLog[]> = {}
  if (requirements.length > 0) {
    const { data: cambioLogsRaw } = await supabase
      .from('requirement_cambio_logs')
      .select('*')
      .in(
        'requirement_id',
        requirements.map((r) => r.id),
      )
      .order('created_at', { ascending: false })
    for (const log of cambioLogsRaw ?? []) {
      if (!cambioLogsMap[log.requirement_id]) cambioLogsMap[log.requirement_id] = []
      cambioLogsMap[log.requirement_id].push(log as RequirementCambioLog)
    }
  }

  // Pipeline: agrupar por fase-cliente
  const groups = emptyGroups()
  if (cycle) {
    for (const r of requirements) {
      if (r.voided) continue
      if (r.content_type === 'produccion') continue
      if (!PHASES.includes(r.phase as Phase)) continue
      const cp = clientPhaseOf(r.phase as Phase)
      if (!cp) continue
      groups[cp].push({
        id: r.id,
        title: r.title ?? '',
        notes: r.notes ?? null,
        deadline: r.deadline ?? null,
      })
    }
  }

  const totals = computeTotals(requirements)
  const baseLimits = cycle
    ? effectiveLimits(cycle.limits_snapshot_json, cycle.rollover_from_previous_json)
    : null
  const limits = baseLimits
    ? applyContentLimitsWithOverride(
        baseLimits,
        (cycle?.content_limits_override_json ?? null) as Record<string, number> | null,
      )
    : null
  const daysLeft = cycle ? daysUntilEnd(cycle.period_end) : null

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-8">
      {cycle && limits ? (
        <RequirementPanel
          client={client}
          cycle={cycle}
          requirements={requirements}
          totals={totals}
          limits={limits}
          daysLeft={daysLeft}
          isAdmin={false}
          canCreate={false}
          canAssign={false}
          userMap={userMap}
          assignableUsers={[]}
          cambioLogsMap={cambioLogsMap}
          hideHistorySection
          portalMode
        />
      ) : (
        <div className="glass-panel rounded-[2rem] p-8 text-center">
          <p className="text-fm-on-surface-variant text-sm">
            No hay ciclo activo en este momento.
          </p>
        </div>
      )}

      {cycle && (
        <div className="glass-panel rounded-[2rem] p-4 sm:p-6 space-y-4">
          <h3 className="text-base font-semibold text-fm-on-surface">Pipeline</h3>
          <ClientPipelineBoard groups={groups} />
        </div>
      )}
    </div>
  )
}
