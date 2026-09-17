import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BillingCycle, Client, ContentMatrix, ContentMatrixItem, Database, MatrixStatus, Plan, Requirement, WeeklyDistribution,
} from '@/types/db'
import { weeksForBillingPeriod } from '@/types/db'
import { getAvailableContentCredits } from '@/lib/domain/credits'
import { buildEffectiveDistribution } from '@/lib/domain/weekly-distribution'
import { maxWeeksForPeriod } from '@/lib/domain/requirement'
import { limitsToRecord, TIPPABLE_CONTENT_TYPES } from '@/lib/domain/plans'
import { today } from '@/lib/domain/dates'
import {
  compareMatrixItems, computeMatrixUsage, computeTargetPeriods, limitsForDistribution, MATRIX_CONTENT_TYPES,
  periodLabel, resolveMatrixLimits,
  type MatrixLimits, type MatrixUsage, type TargetPeriod,
} from '@/lib/domain/matrix'

export type Db = SupabaseClient<Database>
export type ClientWithPlanRow = Client & { plan: Plan }

// ── Ciclo vigente ────────────────────────────────────────────────────────────

export async function loadCurrentCycle(db: Db, clientId: string): Promise<BillingCycle | null> {
  const { data } = await db
    .from('billing_cycles')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'current')
    .order('created_at', { ascending: false })
    .limit(1)
  return (data?.[0] as BillingCycle | undefined) ?? null
}

// ── Editor ───────────────────────────────────────────────────────────────────

export interface MatrixEditorData {
  matrix: ContentMatrix
  items: ContentMatrixItem[]
  client: ClientWithPlanRow
  cycle: BillingCycle | null
  limits: MatrixLimits
  usage: MatrixUsage
  distribution: WeeklyDistribution
  maxWeek: 4 | 8
  period: { periodStart: string; periodEnd: string; label: string }
  linkedRequirement: Pick<Requirement, 'id' | 'title' | 'phase'> | null
}

export async function loadMatrixEditorData(db: Db, matrixId: string): Promise<MatrixEditorData | null> {
  const { data: matrixRaw } = await db.from('content_matrices').select('*').eq('id', matrixId).maybeSingle()
  if (!matrixRaw) return null
  const matrix = matrixRaw as ContentMatrix

  const [{ data: itemsRaw }, { data: clientRaw }, { data: cycleRows }, credits, linked] = await Promise.all([
    db.from('content_matrix_items').select('*').eq('matrix_id', matrixId)
      .order('deadline', { ascending: true }).order('created_at', { ascending: true }).order('id', { ascending: true }),
    db.from('clients').select('*, plan:plans(*)').eq('id', matrix.client_id).single(),
    // Sin filtrar por status: un ciclo pending_renewal/archived también cuenta.
    db.from('billing_cycles').select('*').eq('client_id', matrix.client_id)
      .eq('period_start', matrix.period_start).order('created_at', { ascending: false }).limit(1),
    getAvailableContentCredits(db, matrix.client_id),
    matrix.matrix_requirement_id
      ? db.from('requirements').select('id, title, phase').eq('id', matrix.matrix_requirement_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  if (!clientRaw) return null
  const client = clientRaw as unknown as ClientWithPlanRow
  const cycle = (cycleRows?.[0] as BillingCycle | undefined) ?? null

  let cycleRequirements: Requirement[] = []
  if (cycle) {
    const { data } = await db.from('requirements').select('*')
      .eq('billing_cycle_id', cycle.id).eq('approval_status', 'approved')
    cycleRequirements = (data ?? []) as Requirement[]
  }

  // Orden canónico (deadline → created_at → id), idéntico al que usa el cliente al reordenar.
  const items = ((itemsRaw ?? []) as ContentMatrixItem[]).sort(compareMatrixItems)
  const limits = resolveMatrixLimits({ cycle, plan: client.plan, cycleRequirements, credits })
  const usage = computeMatrixUsage(items, limits)
  const maxWeek = maxWeeksForPeriod(client.billing_period)
  const distribution = buildEffectiveDistribution({
    clientDistribution: client.weekly_distribution_json,
    planDistribution: client.plan.default_weekly_distribution_json,
    pipelineTypes: usage.activeTypes,
    limits: limitsForDistribution(limits),
    cycleOverride: cycle?.weekly_distribution_override_json ?? null,
    rollover: cycle?.rollover_from_previous_json ?? null,
    weeks: weeksForBillingPeriod(client.billing_period),
  })

  return {
    matrix, items, client, cycle, limits, usage, distribution, maxWeek,
    period: { periodStart: matrix.period_start, periodEnd: matrix.period_end, label: periodLabel(matrix.period_start, matrix.period_end) },
    linkedRequirement: (linked?.data as Pick<Requirement, 'id' | 'title' | 'phase'> | null) ?? null,
  }
}

/** Tipos que comparten presupuesto semanal en proposeDeadline (pool unificado). */
export function sharedTypesFor(limits: MatrixLimits) {
  return limits.unifiedPool != null ? [...TIPPABLE_CONTENT_TYPES] : undefined
}

// ── Lista ────────────────────────────────────────────────────────────────────

export interface MatrixListRow {
  id: string
  title: string
  status: MatrixStatus
  period_start: string
  period_end: string
  label: string
  updated_at: string
  approved_by_name: string | null
  client: { id: string; name: string; logo_url: string | null }
  item_count: number
  capacity: number
}

interface RawListRow {
  id: string; title: string; status: MatrixStatus; period_start: string; period_end: string; updated_at: string
  client: { id: string; name: string; logo_url: string | null; plan: Pick<Plan, 'limits_json' | 'unified_content_limit'> | null } | null
  approver: { full_name: string } | null
  items: Array<{ count: number }> | null
}

function planCapacity(plan: Pick<Plan, 'limits_json' | 'unified_content_limit'> | null): number {
  if (!plan) return 0
  const rec = limitsToRecord(plan.limits_json)
  if (plan.unified_content_limit != null) return plan.unified_content_limit + rec.historia
  return MATRIX_CONTENT_TYPES.reduce((s, t) => s + (rec[t] ?? 0), 0)
}

export async function loadMatricesList(db: Db): Promise<MatrixListRow[]> {
  const { data } = await db
    .from('content_matrices')
    .select(`id, title, status, period_start, period_end, updated_at,
      client:clients(id, name, logo_url, plan:plans(limits_json, unified_content_limit)),
      approver:users!content_matrices_approved_by_fkey(full_name),
      items:content_matrix_items(count)`)
    .order('period_start', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(500)
  const rows = (data ?? []) as unknown as RawListRow[]
  return rows
    .filter((r) => r.client)
    .map((r) => ({
      id: r.id, title: r.title, status: r.status, period_start: r.period_start, period_end: r.period_end,
      label: periodLabel(r.period_start, r.period_end), updated_at: r.updated_at,
      approved_by_name: r.approver?.full_name ?? null,
      client: { id: r.client!.id, name: r.client!.name, logo_url: r.client!.logo_url },
      item_count: r.items?.[0]?.count ?? 0,
      capacity: planCapacity(r.client!.plan),
    }))
}

// ── Faltantes para el próximo ciclo ──────────────────────────────────────────

export interface MissingMatrix {
  clientId: string
  clientName: string
  logoUrl: string | null
  periodStart: string
  periodEnd: string
  label: string
}

export async function loadMissingMatrices(db: Db): Promise<MissingMatrix[]> {
  const [{ data: clientsRaw }, { data: cyclesRaw }, { data: matricesRaw }] = await Promise.all([
    db.from('clients').select('id, name, logo_url, billing_day, billing_period, plan:plans(limits_json)').eq('status', 'active').order('name'),
    db.from('billing_cycles').select('client_id, period_start, period_end').eq('status', 'current'),
    db.from('content_matrices').select('client_id, period_start'),
  ])
  const cycleByClient = new Map<string, { period_start: string; period_end: string }>()
  for (const c of (cyclesRaw ?? []) as Array<{ client_id: string; period_start: string; period_end: string }>) {
    if (!cycleByClient.has(c.client_id)) cycleByClient.set(c.client_id, c)
  }
  const have = new Set(((matricesRaw ?? []) as Array<{ client_id: string; period_start: string }>).map((m) => `${m.client_id}|${m.period_start}`))
  const t = today()
  const out: MissingMatrix[] = []
  type CRow = { id: string; name: string; logo_url: string | null; billing_day: number; billing_period: Client['billing_period']; plan: Pick<Plan, 'limits_json'> | null }
  for (const c of (clientsRaw ?? []) as unknown as CRow[]) {
    if (!c.plan) continue
    // limitsToRecord resuelve matrices_contenido ausente a 1: planes legacy se incluyen a propósito.
    if (limitsToRecord(c.plan.limits_json).matriz_contenido <= 0) continue
    const periods = computeTargetPeriods({ currentCycle: cycleByClient.get(c.id) ?? null, billingDay: c.billing_day, billingPeriod: c.billing_period, today: t, count: 2 })
    const next = periods[1]
    if (have.has(`${c.id}|${next.periodStart}`)) continue
    out.push({ clientId: c.id, clientName: c.name, logoUrl: c.logo_url, periodStart: next.periodStart, periodEnd: next.periodEnd, label: next.label })
  }
  return out
}

// ── Períodos objetivo para un cliente (diálogo) ──────────────────────────────

export interface TargetPeriodsForClient {
  periods: TargetPeriod[]
  /** periodStart → id de matriz existente */
  existing: Record<string, string>
}

export async function loadTargetPeriodsForClient(db: Db, clientId: string): Promise<TargetPeriodsForClient | null> {
  const [{ data: client }, cycle, { data: existingRaw }] = await Promise.all([
    db.from('clients').select('id, billing_day, billing_period').eq('id', clientId).maybeSingle(),
    loadCurrentCycle(db, clientId),
    db.from('content_matrices').select('id, period_start').eq('client_id', clientId),
  ])
  if (!client) return null
  const periods = computeTargetPeriods({ currentCycle: cycle, billingDay: client.billing_day, billingPeriod: client.billing_period, today: today() })
  const existing: Record<string, string> = {}
  for (const m of (existingRaw ?? []) as Array<{ id: string; period_start: string }>) existing[m.period_start] = m.id
  return { periods, existing }
}

// ── Tarjeta del perfil del cliente ───────────────────────────────────────────

export interface ClientMatrixSummary {
  id: string
  title: string
  status: MatrixStatus
  periodStart: string
  periodEnd: string
  label: string
  itemCount: number
}

export async function loadClientMatrices(db: Db, client: Pick<Client, 'id' | 'billing_day' | 'billing_period'>, currentCycle: BillingCycle | null): Promise<{ periods: TargetPeriod[]; matrices: ClientMatrixSummary[] }> {
  const periods = computeTargetPeriods({ currentCycle, billingDay: client.billing_day, billingPeriod: client.billing_period, today: today(), count: 2 })
  const { data } = await db
    .from('content_matrices')
    .select('id, title, status, period_start, period_end, items:content_matrix_items(count)')
    .eq('client_id', client.id)
    .in('period_start', periods.map((p) => p.periodStart))
  type Row = { id: string; title: string; status: MatrixStatus; period_start: string; period_end: string; items: Array<{ count: number }> | null }
  const matrices = ((data ?? []) as unknown as Row[]).map((m) => ({
    id: m.id, title: m.title, status: m.status, periodStart: m.period_start, periodEnd: m.period_end,
    label: periodLabel(m.period_start, m.period_end), itemCount: m.items?.[0]?.count ?? 0,
  }))
  return { periods, matrices }
}
