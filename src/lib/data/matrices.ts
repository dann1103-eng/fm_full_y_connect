import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BillingCycle, Client, ContentMatrix, ContentMatrixItem, Database, MatrixStatus, Plan, Requirement, WeeklyDistribution,
} from '@/types/db'
import { weeksForBillingPeriod } from '@/types/db'
import { getAvailableContentCredits } from '@/lib/domain/credits'
import { buildEffectiveDistribution } from '@/lib/domain/weekly-distribution'
import { maxWeeksForPeriod } from '@/lib/domain/requirement'
import { limitsToRecord, TIPPABLE_CONTENT_TYPES } from '@/lib/domain/plans'
import { addDaysString, today, type DateString } from '@/lib/domain/dates'
import {
  compareMatrixItems, computeMatrixUsage, computeTargetPeriods, limitsForDistribution, MATRIX_CONTENT_TYPES,
  periodLabel, pickCycleForPeriod, resolveMatrixLimits,
  type MatrixLimits, type MatrixUsage, type TargetPeriod,
} from '@/lib/domain/matrix'

export type Db = SupabaseClient<Database>
export type ClientWithPlanRow = Client & { plan: Plan }

/**
 * Los loaders lanzan ante un error de consulta: la página muestra el error boundary en vez de
 * una lista vacía o truncada que parezca válida.
 */
function fail(loader: string, error: { message: string }): never {
  throw new Error(`${loader}: ${error.message}`)
}

// ── Ciclo vigente ────────────────────────────────────────────────────────────

export async function loadCurrentCycle(db: Db, clientId: string): Promise<BillingCycle | null> {
  const { data, error } = await db
    .from('billing_cycles')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'current')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) fail('loadCurrentCycle', error)
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
  /** Requerimiento de matriz vinculado. `voided: true` → fue anulado: el editor ofrece registrar uno nuevo. */
  linkedRequirement: LinkedMatrixRequirement | null
}

export type LinkedMatrixRequirement = Pick<Requirement, 'id' | 'title' | 'phase' | 'voided'>

export async function loadMatrixEditorData(db: Db, matrixId: string): Promise<MatrixEditorData | null> {
  const L = 'loadMatrixEditorData'
  const { data: matrixRaw, error: matrixError } = await db.from('content_matrices').select('*').eq('id', matrixId).maybeSingle()
  if (matrixError) fail(L, matrixError)
  if (!matrixRaw) return null
  const matrix = matrixRaw as ContentMatrix

  const [itemsRes, clientRes, cyclesRes, credits, linkedRes] = await Promise.all([
    db.from('content_matrix_items').select('*').eq('matrix_id', matrixId)
      .order('deadline', { ascending: true }).order('created_at', { ascending: true }).order('id', { ascending: true }),
    db.from('clients').select('*, plan:plans(*)').eq('id', matrix.client_id).maybeSingle(),
    // Todos los ciclos del período, sin filtrar por status: un ciclo pending_renewal/archived también
    // cuenta. Si varios comparten period_start, pickCycleForPeriod elige el representativo.
    db.from('billing_cycles').select('*').eq('client_id', matrix.client_id).eq('period_start', matrix.period_start),
    getAvailableContentCredits(db, matrix.client_id),
    matrix.matrix_requirement_id
      ? db.from('requirements').select('id, title, phase, voided').eq('id', matrix.matrix_requirement_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (itemsRes.error) fail(L, itemsRes.error)
  if (clientRes.error) fail(L, clientRes.error)
  if (cyclesRes.error) fail(L, cyclesRes.error)
  if (linkedRes.error) fail(L, linkedRes.error)
  if (!clientRes.data) return null
  const client = clientRes.data as unknown as ClientWithPlanRow
  const cycle = pickCycleForPeriod((cyclesRes.data ?? []) as BillingCycle[])

  let cycleRequirements: Requirement[] = []
  if (cycle) {
    const { data, error } = await db.from('requirements').select('*')
      .eq('billing_cycle_id', cycle.id).eq('approval_status', 'approved')
    if (error) fail(L, error)
    cycleRequirements = (data ?? []) as Requirement[]
  }

  // Orden canónico (deadline → created_at → id), idéntico al que usa el cliente al reordenar.
  const items = ((itemsRes.data ?? []) as ContentMatrixItem[]).sort(compareMatrixItems)
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
    linkedRequirement: (linkedRes.data as LinkedMatrixRequirement | null) ?? null,
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

export interface MatricesList {
  rows: MatrixListRow[]
  /** true si se alcanzó el límite de filas: puede haber más matrices en la ventana. */
  truncated: boolean
  /** Inicio de la ventana consultada (period_start >= since). */
  since: DateString
}

export const MATRICES_LIST_LIMIT = 1000

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

/** Matrices con period_start en los últimos 12 meses (por defecto), más recientes primero. */
export async function loadMatricesList(db: Db, opts: { since?: DateString } = {}): Promise<MatricesList> {
  const since = opts.since ?? addDaysString(today(), -365)
  const { data, error } = await db
    .from('content_matrices')
    .select(`id, title, status, period_start, period_end, updated_at,
      client:clients(id, name, logo_url, plan:plans(limits_json, unified_content_limit)),
      approver:users!content_matrices_approved_by_fkey(full_name),
      items:content_matrix_items(count)`)
    .gte('period_start', since)
    .order('period_start', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(MATRICES_LIST_LIMIT)
  if (error) fail('loadMatricesList', error)
  const raw = (data ?? []) as unknown as RawListRow[]
  const rows = raw
    .filter((r) => r.client)
    .map((r) => ({
      id: r.id, title: r.title, status: r.status, period_start: r.period_start, period_end: r.period_end,
      label: periodLabel(r.period_start, r.period_end), updated_at: r.updated_at,
      approved_by_name: r.approver?.full_name ?? null,
      client: { id: r.client!.id, name: r.client!.name, logo_url: r.client!.logo_url },
      item_count: r.items?.[0]?.count ?? 0,
      capacity: planCapacity(r.client!.plan),
    }))
  return { rows, truncated: raw.length === MATRICES_LIST_LIMIT, since }
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
  const L = 'loadMissingMatrices'
  const [clientsRes, cyclesRes] = await Promise.all([
    db.from('clients').select('id, name, logo_url, billing_day, billing_period, plan:plans(limits_json)').eq('status', 'active').order('name'),
    // created_at desc: si un cliente tiene más de un ciclo current, gana el más reciente (determinista).
    db.from('billing_cycles').select('client_id, period_start, period_end').eq('status', 'current').order('created_at', { ascending: false }),
  ])
  if (clientsRes.error) fail(L, clientsRes.error)
  if (cyclesRes.error) fail(L, cyclesRes.error)

  const cycleByClient = new Map<string, { period_start: string; period_end: string }>()
  for (const c of (cyclesRes.data ?? []) as Array<{ client_id: string; period_start: string; period_end: string }>) {
    if (!cycleByClient.has(c.client_id)) cycleByClient.set(c.client_id, c)
  }

  // 1) Próximo período de cada cliente con cupo de matriz.
  const t = today()
  const candidates: MissingMatrix[] = []
  type CRow = { id: string; name: string; logo_url: string | null; billing_day: number; billing_period: Client['billing_period']; plan: Pick<Plan, 'limits_json'> | null }
  for (const c of (clientsRes.data ?? []) as unknown as CRow[]) {
    if (!c.plan) continue
    // limitsToRecord resuelve matrices_contenido ausente a 1: planes legacy se incluyen a propósito.
    if (limitsToRecord(c.plan.limits_json).matriz_contenido <= 0) continue
    const periods = computeTargetPeriods({ currentCycle: cycleByClient.get(c.id) ?? null, billingDay: c.billing_day, billingPeriod: c.billing_period, today: t, count: 2 })
    const next = periods[1]
    candidates.push({ clientId: c.id, clientName: c.name, logoUrl: c.logo_url, periodStart: next.periodStart, periodEnd: next.periodEnd, label: next.label })
  }
  if (candidates.length === 0) return []

  // 2) Solo las matrices de esos inicios de período (no toda la tabla).
  const uniqueStarts = [...new Set(candidates.map((m) => m.periodStart))]
  const { data: matricesRaw, error: matricesError } = await db
    .from('content_matrices').select('client_id, period_start').in('period_start', uniqueStarts)
  if (matricesError) fail(L, matricesError)
  const have = new Set(((matricesRaw ?? []) as Array<{ client_id: string; period_start: string }>).map((m) => `${m.client_id}|${m.period_start}`))
  return candidates.filter((m) => !have.has(`${m.clientId}|${m.periodStart}`))
}

// ── Períodos objetivo para un cliente (diálogo) ──────────────────────────────

export interface TargetPeriodsForClient {
  periods: TargetPeriod[]
  /** periodStart → id de matriz existente */
  existing: Record<string, string>
}

export async function loadTargetPeriodsForClient(db: Db, clientId: string): Promise<TargetPeriodsForClient | null> {
  const L = 'loadTargetPeriodsForClient'
  const [clientRes, cycle, existingRes] = await Promise.all([
    db.from('clients').select('id, billing_day, billing_period').eq('id', clientId).maybeSingle(),
    loadCurrentCycle(db, clientId),
    db.from('content_matrices').select('id, period_start').eq('client_id', clientId),
  ])
  if (clientRes.error) fail(L, clientRes.error)
  if (existingRes.error) fail(L, existingRes.error)
  const client = clientRes.data
  if (!client) return null
  const periods = computeTargetPeriods({ currentCycle: cycle, billingDay: client.billing_day, billingPeriod: client.billing_period, today: today() })
  const existing: Record<string, string> = {}
  for (const m of (existingRes.data ?? []) as Array<{ id: string; period_start: string }>) existing[m.period_start] = m.id
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
  const { data, error } = await db
    .from('content_matrices')
    .select('id, title, status, period_start, period_end, items:content_matrix_items(count)')
    .eq('client_id', client.id)
    .in('period_start', periods.map((p) => p.periodStart))
  if (error) fail('loadClientMatrices', error)
  type Row = { id: string; title: string; status: MatrixStatus; period_start: string; period_end: string; items: Array<{ count: number }> | null }
  const matrices = ((data ?? []) as unknown as Row[]).map((m) => ({
    id: m.id, title: m.title, status: m.status, periodStart: m.period_start, periodEnd: m.period_end,
    label: periodLabel(m.period_start, m.period_end), itemCount: m.items?.[0]?.count ?? 0,
  }))
  return { periods, matrices }
}
