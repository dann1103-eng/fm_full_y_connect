import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { RequirementPanel } from '@/components/clients/RequirementPanel'
import { CycleHistory } from '@/components/clients/CycleHistory'
import { ReactivatePanel } from '@/components/clients/ReactivatePanel'
import type { ClientWithPlan, BillingCycle, Requirement, Plan } from '@/types/db'
import { computeTotals } from '@/lib/domain/requirement'
import { effectiveLimits } from '@/lib/domain/plans'
import { daysUntilEnd } from '@/lib/domain/cycles'
import { ClientPipelineTab } from '@/components/pipeline/ClientPipelineTab'
import { PIPELINE_CONTENT_TYPES } from '@/lib/domain/pipeline'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { RequirementPhaseLog, RequirementCambioLog } from '@/types/db'
import { DeleteClientButton } from '@/components/clients/DeleteClientButton'
import { RequirementHistory } from '@/components/clients/RequirementHistory'
import { ClientNotesPanel } from '@/components/clients/ClientNotesPanel'

export const dynamic = 'force-dynamic'

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: clientRaw } = await supabase
    .from('clients')
    .select('*, plan:plans(*)')
    .eq('id', id)
    .single()

  if (!clientRaw) notFound()
  const client = clientRaw as ClientWithPlan

  // Current cycle
  const { data: currentCycle } = await supabase
    .from('billing_cycles')
    .select('*')
    .eq('client_id', id)
    .eq('status', 'current')
    .maybeSingle()

  // All past cycles
  const { data: pastCycles } = await supabase
    .from('billing_cycles')
    .select('*')
    .eq('client_id', id)
    .in('status', ['archived', 'pending_renewal'])
    .order('period_start', { ascending: false })

  // Plans (for reactivation panel)
  const { data: plans } = await supabase
    .from('plans')
    .select('*')
    .eq('active', true)
    .order('price_usd')

  // Requirements for current cycle
  const { data: requirements } = currentCycle
    ? await supabase
        .from('requirements')
        .select('*')
        .eq('billing_cycle_id', currentCycle.id)
        .order('registered_at', { ascending: false })
    : { data: [] }

  // Internal users (for "registered by" display in history)
  const { data: users } = await supabase
    .from('users')
    .select('id, full_name, role, avatar_url, default_assignee')

  const userMap: Record<string, string> = {}
  const userAvatarMap: Record<string, string | null> = {}
  ;(users ?? []).forEach((u) => {
    userMap[u.id] = u.full_name || (u.role === 'admin' ? 'Admin' : u.role === 'supervisor' ? 'Supervisor' : 'Operador')
    userAvatarMap[u.id] = u.avatar_url ?? null
  })

  // Cambio logs for current cycle requirements
  const cambioLogsMap: Record<string, RequirementCambioLog[]> = {}
  if (requirements && requirements.length > 0) {
    const { data: cambioLogsRaw } = await supabase
      .from('requirement_cambio_logs')
      .select('*')
      .in('requirement_id', requirements.map(r => r.id))
      .order('created_at', { ascending: false })
    for (const log of cambioLogsRaw ?? []) {
      if (!cambioLogsMap[log.requirement_id]) cambioLogsMap[log.requirement_id] = []
      cambioLogsMap[log.requirement_id].push(log as RequirementCambioLog)
    }
  }

  // Pipeline items del ciclo actual
  const pipelineItems: PipelineItem[] = []
  const pipelineLogsMap: Record<string, RequirementPhaseLog[]> = {}

  if (currentCycle) {
    const { data: pipelineCons } = await supabase
      .from('requirements')
      .select('id, content_type, phase, carried_over, billing_cycle_id, registered_at, notes, title, cambios_count, review_started_at, priority, estimated_time_minutes, assigned_to, includes_story, deadline')
      .eq('billing_cycle_id', currentCycle.id)
      .eq('voided', false)
      .in('content_type', PIPELINE_CONTENT_TYPES)
      .order('registered_at', { ascending: false })

    for (const c of pipelineCons ?? []) {
      pipelineItems.push({
        id: c.id,
        content_type: c.content_type,
        phase: c.phase,
        billing_cycle_id: c.billing_cycle_id,
        client_id: id,
        client_name: client.name,
        client_logo_url: client.logo_url,
        last_moved_at: c.registered_at,
        registered_at: c.registered_at,
        notes: c.notes,
        carried_over: c.carried_over,
        title: c.title ?? '',
        cambios_count: c.cambios_count ?? 0,
        review_started_at: c.review_started_at ?? null,
        priority: (c.priority ?? 'media') as import('@/types/db').Priority,
        estimated_time_minutes: c.estimated_time_minutes ?? null,
        assigned_to: (c.assigned_to as string[] | null) ?? null,
        assignees: ((c.assigned_to as string[] | null) ?? []).map(uid => ({
          id: uid,
          name: userMap[uid] ?? uid,
          avatar_url: userAvatarMap[uid] ?? null,
        })),
        includes_story: c.includes_story ?? false,
        deadline: c.deadline ?? null,
      })
    }

    if (pipelineItems.length > 0) {
      const { data: logsRaw } = await supabase
        .from('requirement_phase_logs')
        .select('*')
        .in('requirement_id', pipelineItems.map((i) => i.id))
        .order('created_at', { ascending: true })

      for (const log of logsRaw ?? []) {
        if (!pipelineLogsMap[log.requirement_id]) pipelineLogsMap[log.requirement_id] = []
        pipelineLogsMap[log.requirement_id].push(log as RequirementPhaseLog)
      }

      for (const item of pipelineItems) {
        const logs = pipelineLogsMap[item.id] ?? []
        if (logs.length > 0) item.last_moved_at = logs[logs.length - 1].created_at
      }
    }
  }

  const cycle = currentCycle as BillingCycle | null
  const reqs = (requirements ?? []) as Requirement[]
  const totals = computeTotals(reqs)
  const limits = cycle
    ? effectiveLimits(cycle.limits_snapshot_json, cycle.rollover_from_previous_json)
    : null
  const daysLeft = cycle ? daysUntilEnd(cycle.period_end) : null

  // Get current user role for permissions
  const { data: { user: authUser } } = await supabase.auth.getUser()
  const { data: appUser } = authUser
    ? await supabase.from('users').select('role').eq('id', authUser.id).single()
    : { data: null }
  const isAdmin = appUser?.role === 'admin'
  const canCreate = appUser?.role === 'admin' || appUser?.role === 'supervisor'

  return (
    <div className="flex flex-col h-full">
      <TopNav title={client.name} />

      <div className="flex-1 p-3 sm:p-6 space-y-4 sm:space-y-8">
        {/* Breadcrumb */}
        <nav className="flex flex-wrap items-center gap-2 text-sm pt-2 min-w-0">
          <Link
            href="/clients"
            className="text-fm-on-surface-variant flex items-center gap-1 hover:text-fm-primary transition-colors"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Clientes
          </Link>
          <span className="text-fm-outline-variant">/</span>
          <span className="font-semibold text-fm-on-surface">{client.name}</span>
        </nav>

        {/* 1 — Requerimientos del ciclo (sin historial al final) */}
        {cycle && limits ? (
          <RequirementPanel
            client={client}
            cycle={cycle}
            requirements={reqs}
            totals={totals}
            limits={limits}
            daysLeft={daysLeft}
            isAdmin={isAdmin}
            canCreate={canCreate}
            userMap={userMap}
            assignableUsers={(users ?? []).map(u => ({
              id: u.id,
              full_name: u.full_name || u.role,
              default_assignee: u.default_assignee ?? false,
            }))}
            canAssign={canCreate}
            cambioLogsMap={cambioLogsMap}
            hideHistorySection
          />
        ) : client.status === 'paused' && isAdmin ? (
          <ReactivatePanel client={client} plans={(plans ?? []) as Plan[]} />
        ) : (
          <div className="glass-panel rounded-[2rem] p-8 text-center">
            <p className="text-fm-on-surface-variant text-sm">No hay ciclo activo para este cliente.</p>
          </div>
        )}

        {/* 2 — Pipeline del ciclo actual */}
        {cycle && (
          <div className="glass-panel rounded-[2rem] p-4 sm:p-6 space-y-4">
            <h3 className="text-base font-semibold text-fm-on-surface">Pipeline</h3>
            <ClientPipelineTab
              items={pipelineItems}
              logsMap={pipelineLogsMap}
              currentUserId={authUser?.id ?? ''}
              canAssign={canCreate}
            />
          </div>
        )}

        {/* 3 — Historial del ciclo + Notas internas */}
        {cycle && (
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-8">
            <div className="lg:col-span-7 space-y-4">
              <h3 className="text-xl font-extrabold tracking-tight text-fm-on-surface">
                Historial del ciclo
              </h3>
              <RequirementHistory
                requirements={reqs}
                isAdmin={isAdmin}
                cycleId={cycle.id}
                userMap={userMap}
                cambioLogsMap={cambioLogsMap}
              />
            </div>
            <div className="lg:col-span-5 space-y-4">
              <h3 className="text-xl font-extrabold tracking-tight text-fm-on-surface">
                Notas internas
              </h3>
              <ClientNotesPanel clientId={client.id} initialNotes={client.notes ?? null} />
            </div>
          </section>
        )}

        {/* 4 — Historial de ciclos pasados */}
        {pastCycles && pastCycles.length > 0 && (
          <CycleHistory
            cycles={pastCycles as BillingCycle[]}
            clientId={id}
            supabase={null}
            plansMap={Object.fromEntries((plans ?? []).map((p) => [p.id, p.name]))}
          />
        )}

        {/* Delete client — admin only */}
        {isAdmin && (
          <div className="pt-4">
            <DeleteClientButton clientId={client.id} clientName={client.name} />
          </div>
        )}
      </div>
    </div>
  )
}
