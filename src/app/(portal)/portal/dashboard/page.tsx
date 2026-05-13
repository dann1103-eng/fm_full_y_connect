import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientId } from '@/lib/supabase/active-client'
import { requirePortalCapability } from '@/lib/auth/portal-permissions'
import { RequirementPanel } from '@/components/clients/RequirementPanel'
import { ClientPipelineBoard } from '@/components/portal/ClientPipelineBoard'
import { RenewalBanner } from '@/components/portal/RenewalBanner'
import { ExtrasSection } from '@/components/portal/ExtrasSection'
import { SolicitarRequerimientoButton } from '@/components/portal/SolicitarRequerimientoButton'
import { PendingRequestsSection, type PendingRequestItem } from '@/components/portal/PendingRequestsSection'
import { computeTotals } from '@/lib/domain/requirement'
import { effectiveLimits, applyContentLimitsWithOverride } from '@/lib/domain/plans'
import { daysUntilEnd } from '@/lib/domain/cycles'
import { clientPhaseOf, PHASES } from '@/lib/domain/pipeline'
import type { ClientPhase } from '@/lib/domain/pipeline'
import type {
  BillingCycle,
  CambiosPackage,
  ClientWithPlan,
  Phase,
  Requirement,
  RequirementCambioLog,
} from '@/types/db'

export const dynamic = 'force-dynamic'

type PipelineCardItem = {
  id: string
  title: string
  notes: string | null
  deadline: string | null
  phase: Phase
  review_started_at: string | null
}

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
  await requirePortalCapability('work')
  const activeId = await getActiveClientId()
  if (!activeId) redirect('/portal/seleccionar-marca')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

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

  // Solicitudes pending y rejected del ciclo actual
  const pendingAndRejectedRequests: PendingRequestItem[] = []
  if (cycle) {
    const { data: pendingRows } = await supabase
      .from('requirements')
      .select('id, title, content_type, notes, client_requested_deadline, includes_story, approval_status, rejected_reason, client_request_attachments_json, client_request_links_json')
      .eq('billing_cycle_id', cycle.id)
      .in('approval_status', ['pending', 'rejected'])
      .eq('voided', false)
      .order('registered_at', { ascending: false })
    for (const r of pendingRows ?? []) {
      pendingAndRejectedRequests.push(r as unknown as PendingRequestItem)
    }
  }

  const { data: requirementsRaw } = cycle
    ? await supabase
        .from('requirements')
        .select('*')
        .eq('billing_cycle_id', cycle.id)
        .eq('approval_status', 'approved')
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
        phase: r.phase as Phase,
        review_started_at: r.review_started_at ?? null,
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

  // ── Banner de renovación: cargar facturas pendientes + estado scheduled ──
  // 1. Facturas issued no anuladas del cliente (= "pendientes de pago")
  const { data: pendingInvoicesRows } = await supabase
    .from('invoices')
    .select('id, invoice_number, total, n1co_payment_link_url, due_date')
    .eq('client_id', activeId)
    .eq('status', 'issued')
    .order('issue_date', { ascending: true })
  const pendingInvoices = (pendingInvoicesRows ?? []).map((inv) => ({
    id: inv.id as string,
    invoice_number: inv.invoice_number as string,
    total: Number(inv.total),
    n1co_payment_link_url: (inv.n1co_payment_link_url as string | null) ?? null,
    due_date: (inv.due_date as string | null) ?? null,
  }))

  // 2. Scheduled cycle (renovación) y si ya está pagado
  let scheduledCycleForBanner: { period_start: string; paid: boolean } | null = null
  if (cycle) {
    const { data: scheduled } = await supabase
      .from('billing_cycles')
      .select('id, period_start, payment_status')
      .eq('client_id', activeId)
      .eq('status', 'scheduled')
      .maybeSingle()
    if (scheduled?.id) {
      // El payment_status del cycle se sincroniza al pagar la factura, pero verificamos
      // también la última factura no-void del scheduled cycle para confirmar.
      const { data: scheduledInv } = await supabase
        .from('invoices')
        .select('status')
        .eq('billing_cycle_id', scheduled.id)
        .neq('status', 'void')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const paidByInvoice = scheduledInv?.status === 'paid'
      const paidByCycle = scheduled.payment_status === 'paid'
      scheduledCycleForBanner = {
        period_start: scheduled.period_start as string,
        paid: paidByInvoice || paidByCycle,
      }
    }
  }

  // Paquetes de cambios sugeridos: combina los del ciclo (con precio) + el estándar.
  const cycleCambiosPkgs = ((cycle?.cambios_packages_json ?? []) as CambiosPackage[])
    .filter((p) => p.price_usd && p.price_usd > 0)
    .map((p) => ({ qty: p.qty, price: p.price_usd ?? 0, note: p.note }))
  const cambiosOptions = cycleCambiosPkgs.length > 0 ? cycleCambiosPkgs : undefined

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-fm-on-surface">Dashboard</h1>
        <SolicitarRequerimientoButton />
      </div>

      {pendingAndRejectedRequests.length > 0 && (
        <PendingRequestsSection requests={pendingAndRejectedRequests} />
      )}

      {cycle && (
        <RenewalBanner
          currentPeriodEnd={cycle.period_end}
          currentPaymentStatus={cycle.payment_status}
          autoBillingEnabled={client.auto_billing}
          pendingInvoices={pendingInvoices}
          scheduledCycle={scheduledCycleForBanner}
        />
      )}

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
        <ExtrasSection cambiosOptions={cambiosOptions} />
      )}

      {cycle && (
        <div className="glass-panel rounded-[2rem] p-4 sm:p-6 space-y-4">
          <h3 className="text-base font-semibold text-fm-on-surface">Pipeline</h3>
          <ClientPipelineBoard
            groups={groups}
            clientId={activeId}
            currentUserId={user.id}
          />
        </div>
      )}
    </div>
  )
}
