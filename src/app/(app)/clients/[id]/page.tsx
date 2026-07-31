import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { TopNav } from '@/components/layout/TopNav'
import { RequirementPanel } from '@/components/clients/RequirementPanel'
import { CycleHistory } from '@/components/clients/CycleHistory'
import { ReactivatePanel } from '@/components/clients/ReactivatePanel'
import type { ClientWithPlan, BillingCycle, Requirement, Plan } from '@/types/db'
import { computeTotals } from '@/lib/domain/requirement'
import { effectiveLimits, applyContentLimitsWithOverride } from '@/lib/domain/plans'
import { daysUntilEnd } from '@/lib/domain/cycles'
import { ClientPipelineTab } from '@/components/pipeline/ClientPipelineTab'
import { PIPELINE_CONTENT_TYPES } from '@/lib/domain/pipeline'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { RequirementPhaseLog, RequirementCambioLog } from '@/types/db'
import { DeleteClientButton } from '@/components/clients/DeleteClientButton'
import { PauseClientButton } from '@/components/clients/PauseClientButton'
import { GracePeriodControl } from '@/components/renewals/GracePeriodControl'
import { CycleHistorySwitcher } from '@/components/clients/CycleHistorySwitcher'
import { ClientNotesPanel } from '@/components/clients/ClientNotesPanel'
import { ClientPortalInvite } from '@/components/clients/ClientPortalInvite'
import { InactiveClientBanner } from '@/components/clients/InactiveClientBanner'
import { RescueOrphansButton } from '@/components/clients/RescueOrphansButton'
import { listClientUsers } from '@/app/actions/clientUsers'
import { listClientCredits } from '@/app/actions/credits'
import { ClientCreditsCard } from '@/components/clients/ClientCreditsCard'

export const dynamic = 'force-dynamic'

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const ctx = await getEffectiveUser()
  if (!ctx) redirect('/login')
  const effectiveId = ctx.appUser.id
  const role = ctx.appUser.role
  const isOperator = role === 'operator'
  const isAdmin = role === 'admin'
  const isApprover = isAdmin || role === 'supervisor'
  const canCreate = isAdmin || role === 'supervisor'

  // Queries independientes en paralelo — corta el tiempo total a la latencia
  // de la query más lenta en lugar de sumarlas secuencialmente.
  const [
    { data: clientRaw },
    { data: currentCycleRows },
    { data: pastCycles },
    { data: plans },
    { data: users },
  ] = await Promise.all([
    supabase
      .from('clients')
      .select('*, plan:plans(*)')
      .eq('id', id)
      .single(),
    // limit(1) en vez de maybeSingle(): tolera duplicados de ciclo 'current'
    // (si existieran) mostrando el más reciente en lugar de romperse con error.
    supabase
      .from('billing_cycles')
      .select('*')
      .eq('client_id', id)
      .eq('status', 'current')
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('billing_cycles')
      .select('*')
      .eq('client_id', id)
      .in('status', ['archived', 'pending_renewal'])
      .order('period_start', { ascending: false }),
    supabase
      .from('plans')
      .select('*')
      .eq('active', true)
      .order('price_usd'),
    supabase
      .from('users')
      .select('id, full_name, role, avatar_url, default_assignee'),
  ])

  const currentCycle = currentCycleRows?.[0] ?? null

  if (!clientRaw) notFound()
  const client = clientRaw as ClientWithPlan

  // Requirements for current cycle (operator: only assigned to him)
  let reqsQuery = currentCycle
    ? supabase
        .from('requirements')
        .select('*')
        .eq('billing_cycle_id', currentCycle.id)
        .eq('approval_status', 'approved')
    : null
  if (reqsQuery && isOperator) {
    reqsQuery = reqsQuery.contains('assigned_to', [effectiveId])
  }
  const { data: requirements } = reqsQuery
    ? await reqsQuery.order('registered_at', { ascending: false })
    : { data: [] }

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

  // Previous cycle (más reciente archived) — para el toggle "Ciclo anterior"
  // del componente CycleHistorySwitcher en el historial del cliente.
  const previousCycle = (pastCycles ?? [])[0] ?? null
  let previousReqs: Requirement[] = []
  const cambioLogsMapPrevious: Record<string, RequirementCambioLog[]> = {}
  if (previousCycle) {
    let prevQ = supabase
      .from('requirements')
      .select('*')
      .eq('billing_cycle_id', previousCycle.id)
      .eq('approval_status', 'approved')
    if (isOperator) prevQ = prevQ.contains('assigned_to', [effectiveId])
    const { data: prevReqsRaw } = await prevQ.order('registered_at', { ascending: false })
    previousReqs = (prevReqsRaw ?? []) as Requirement[]
    if (previousReqs.length > 0) {
      const { data: prevCambioLogsRaw } = await supabase
        .from('requirement_cambio_logs')
        .select('*')
        .in('requirement_id', previousReqs.map(r => r.id))
        .order('created_at', { ascending: false })
      for (const log of prevCambioLogsRaw ?? []) {
        if (!cambioLogsMapPrevious[log.requirement_id]) cambioLogsMapPrevious[log.requirement_id] = []
        cambioLogsMapPrevious[log.requirement_id].push(log as RequirementCambioLog)
      }
    }
  }

  // Pipeline items del ciclo actual
  const pipelineItems: PipelineItem[] = []
  const scheduledPipelineItems: PipelineItem[] = []
  const pipelineLogsMap: Record<string, RequirementPhaseLog[]> = {}

  if (currentCycle) {
    let pipelineQ = supabase
      .from('requirements')
      .select('id, content_type, phase, carried_over, billing_cycle_id, registered_at, notes, title, cambios_count, review_started_at, priority, estimated_time_minutes, assigned_to, includes_story, deadline, starts_at')
      .eq('billing_cycle_id', currentCycle.id)
      .eq('voided', false)
      .neq('approval_status', 'rejected')
      .in('content_type', PIPELINE_CONTENT_TYPES)
    if (isOperator) pipelineQ = pipelineQ.contains('assigned_to', [effectiveId])
    const { data: pipelineCons } = await pipelineQ.order('registered_at', { ascending: false })

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
        starts_at: c.starts_at ?? null,
      })
    }

    // Fetch reunion/produccion items separately (not in PIPELINE_CONTENT_TYPES)
    let schedQ = supabase
      .from('requirements')
      .select('id, content_type, phase, carried_over, billing_cycle_id, registered_at, notes, title, cambios_count, review_started_at, priority, estimated_time_minutes, assigned_to, includes_story, deadline, starts_at')
      .eq('billing_cycle_id', currentCycle.id)
      .eq('voided', false)
      .in('content_type', ['reunion', 'produccion'])
    if (isOperator) schedQ = schedQ.contains('assigned_to', [effectiveId])
    const { data: scheduledCons } = await schedQ.order('starts_at', { ascending: true })

    scheduledPipelineItems.push(...(scheduledCons ?? []).map((c) => ({
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
      starts_at: c.starts_at ?? null,
    })))

    const allPipelineIds = [...pipelineItems.map((i) => i.id), ...scheduledPipelineItems.map((i) => i.id)]

    if (allPipelineIds.length > 0) {
      const { data: logsRaw } = await supabase
        .from('requirement_phase_logs')
        .select('*')
        .in('requirement_id', allPipelineIds)
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
  const credits = await listClientCredits(id)
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

  let portalUsers: Awaited<ReturnType<typeof listClientUsers>> = []
  if (isAdmin) {
    try {
      portalUsers = await listClientUsers(id)
    } catch (e) {
      console.error('[ClientDetailPage] listClientUsers error:', e)
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      <TopNav title={client.name} />

      <div className="flex-1 p-3 sm:p-6 space-y-4 sm:space-y-8 overflow-x-hidden">
        {/* Banner de suspensión por impago (visible para todos los roles) */}
        {(client.status === 'inactive_payment' || client.status === 'inactive_manual') && (
          <InactiveClientBanner
            clientId={client.id}
            status={client.status}
            reason={client.deactivation_reason ?? null}
            deactivatedAt={client.deactivated_at ?? null}
            canReactivate={isApprover}
          />
        )}

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

        {/* 0 — Créditos sin caducidad disponibles */}
        {(credits.cambios > 0 || Object.values(credits.content).some((q) => (q ?? 0) > 0)) && (
          <ClientCreditsCard cambios={credits.cambios} content={credits.content} />
        )}

        {/* Período de gracia: visible para admin si el ciclo current está impago
            o ya tiene gracia. Permite otorgar/extender/anular. */}
        {isApprover && cycle && (cycle.payment_status === 'unpaid' || cycle.grace_period_until) && (
          <GracePeriodControl
            cycleId={cycle.id}
            clientId={client.id}
            graceUntil={cycle.grace_period_until ?? null}
            variant="full"
          />
        )}

        {/* 1 — Requerimientos del ciclo (sin historial al final) */}
        {cycle && limits ? (
          <RequirementPanel
            client={client}
            cycle={cycle}
            requirements={reqs}
            totals={totals}
            limits={limits}
            availableCredits={credits.content}
            currentUserId={effectiveId}
            daysLeft={daysLeft}
            isAdmin={isAdmin}
            isApprover={isApprover}
            canCreate={canCreate}
            userMap={userMap}
            assignableUsers={(users ?? []).filter(u => u.role !== 'client').map(u => ({
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
            {isAdmin && (
              <Link
                href={`/clients/${client.id}/edit`}
                className="inline-flex items-center gap-1.5 mt-4 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
              >
                <span className="material-symbols-outlined text-[18px]">add_circle</span>
                Crear ciclo activo
              </Link>
            )}
          </div>
        )}

        {/* 2 — Pipeline del ciclo actual */}
        {cycle && (
          <div className="glass-panel rounded-[2rem] p-4 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <h3 className="text-base font-semibold text-fm-on-surface">Pipeline</h3>
              {isApprover && <RescueOrphansButton clientId={id} />}
            </div>
            <ClientPipelineTab
              items={pipelineItems}
              scheduledItems={scheduledPipelineItems}
              logsMap={pipelineLogsMap}
              currentUserId={effectiveId}
              canAssign={canCreate}
              isAdmin={isAdmin}
              isApprover={isApprover}
            />
          </div>
        )}

        {/* 3 — Historial del ciclo + Notas internas */}
        {cycle && (
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-8">
            <div className="lg:col-span-7 space-y-4">
              <CycleHistorySwitcher
                currentReqs={reqs}
                currentCycleId={cycle.id}
                previousReqs={previousCycle ? previousReqs : null}
                previousCycleId={previousCycle?.id ?? null}
                previousPeriodStart={previousCycle?.period_start ?? null}
                isAdmin={isAdmin}
                isApprover={isApprover}
                userMap={userMap}
                cambioLogsMapCurrent={cambioLogsMap}
                cambioLogsMapPrevious={cambioLogsMapPrevious}
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

        {/* 4 — Historial de ciclos pasados (oculto para operadores) */}
        {!isOperator && pastCycles && pastCycles.length > 0 && (
          <CycleHistory
            cycles={pastCycles as BillingCycle[]}
            clientId={id}
            plansMap={Object.fromEntries((plans ?? []).map((p) => [p.id, p.name]))}
            isAdmin={isAdmin}
            isApprover={isApprover}
            userMap={userMap}
          />
        )}

        {/* Portal del cliente — solo admin */}
        {isAdmin && (
          <ClientPortalInvite clientId={id} users={portalUsers} />
        )}

        {/* Acciones de admin: pausar + eliminar */}
        {isAdmin && (
          <div className="pt-4 flex items-start gap-6 flex-wrap">
            {cycle && client.status === 'active' && (
              <PauseClientButton
                clientId={client.id}
                cycleId={cycle.id}
                clientName={client.name}
              />
            )}
            <DeleteClientButton clientId={client.id} clientName={client.name} />
          </div>
        )}
      </div>
    </div>
  )
}
