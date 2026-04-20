// src/app/(app)/reports/page.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { CsvDownloadButton } from '@/components/reports/CsvDownloadButton'
import { TimesheetReport } from '@/components/reports/TimesheetReport'
import { TimeByRequirementPhaseReport } from '@/components/reports/TimeByRequirementPhaseReport'
import { computeTotals } from '@/lib/domain/requirement'
import { effectiveLimits } from '@/lib/domain/plans'
import { daysUntilEnd } from '@/lib/domain/cycles'
import { CONTENT_TYPES, CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import { PIPELINE_CONTENT_TYPES, PHASES, PHASE_LABELS } from '@/lib/domain/pipeline'
import type { BillingCycle, Requirement, ContentType } from '@/types/db'

export const dynamic = 'force-dynamic'

const MONTHS_SHORT = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
const MONTHS_FULL  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function barColor(pct: number): string {
  if (pct >= 90) return '#b31b25'
  if (pct >= 70) return '#f59e0b'
  return '#00675c'
}

function AccordionSection({
  title,
  subtitle,
  defaultOpen = false,
  headerRight,
  children,
}: {
  title: string
  subtitle?: string
  defaultOpen?: boolean
  headerRight?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <details
      className="glass-panel rounded-[2rem] overflow-hidden group"
      open={defaultOpen || undefined}
    >
      <summary className="px-8 py-5 cursor-pointer list-none flex items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
        <div className="flex items-baseline gap-3 min-w-0">
          <h2 className="text-xl font-extrabold tracking-tight text-[#2c2f31] truncate">
            {title}
          </h2>
          {subtitle && (
            <span className="text-xs text-[#595c5e] truncate">{subtitle}</span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {headerRight}
          <span className="material-symbols-outlined text-[#595c5e] transition-transform group-open:rotate-180">
            expand_more
          </span>
        </div>
      </summary>
      <div className="px-8 pb-8">{children}</div>
    </details>
  )
}

export default async function ReportsPage() {
  const supabase = await createClient()

  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) redirect('/login')
  const { data: authUserRow } = await supabase.from('users').select('role').eq('id', authUser.id).single()
  if (authUserRow?.role === 'operator') redirect('/')

  // Users + clients list (para filtros del timesheet report)
  const { data: usersList } = await supabase
    .from('users')
    .select('id, full_name, avatar_url')
    .order('full_name')
  const { data: clientsList } = await supabase
    .from('clients')
    .select('id, name')
    .order('name')

  // 1. All clients
  const { data: clientsRaw } = await supabase
    .from('clients')
    .select('id, name, status, current_plan_id')
    .order('name')
  const clients = clientsRaw ?? []

  // 2. Current cycles
  const { data: currentCyclesRaw } = await supabase
    .from('billing_cycles')
    .select('*')
    .eq('status', 'current')
  const currentCycles = (currentCyclesRaw ?? []) as BillingCycle[]
  const currentCycleIds = currentCycles.map((c) => c.id)

  // Maps for lookups
  const cycleByClientId: Record<string, BillingCycle> = {}
  for (const c of currentCycles) cycleByClientId[c.client_id] = c

  // 3. All plans
  const { data: plansRaw } = await supabase.from('plans').select('id, name, price_usd')
  const plansMap: Record<string, { name: string; price_usd: number }> = {}
  for (const p of plansRaw ?? []) plansMap[p.id] = { name: p.name, price_usd: p.price_usd }

  // 4. Requirements for all current cycles (guarded)
  let allRequirements: Requirement[] = []
  if (currentCycleIds.length > 0) {
    const { data: reqsRaw } = await supabase
      .from('requirements')
      .select('*')
      .in('billing_cycle_id', currentCycleIds)
    allRequirements = (reqsRaw ?? []) as Requirement[]
  }

  // Group requirements by billing_cycle_id
  const consByCycleId: Record<string, Requirement[]> = {}
  for (const c of allRequirements) {
    if (!consByCycleId[c.billing_cycle_id]) consByCycleId[c.billing_cycle_id] = []
    consByCycleId[c.billing_cycle_id].push(c)
  }

  // 5. Pipeline pieces for summary (guarded)
  const pipelineCountByPhase: Record<string, number> = {}
  if (currentCycleIds.length > 0) {
    const { data: pipelineRaw } = await supabase
      .from('requirements')
      .select('phase')
      .eq('voided', false)
      .in('content_type', PIPELINE_CONTENT_TYPES)
      .in('billing_cycle_id', currentCycleIds)
    for (const item of pipelineRaw ?? []) {
      pipelineCountByPhase[item.phase] = (pipelineCountByPhase[item.phase] ?? 0) + 1
    }
  }

  // ── Aggregates ──

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Summary counts
  const totalActive = clients.filter((cl) => cl.status === 'active').length
  const totalPaused = clients.filter((cl) => cl.status === 'paused').length
  const totalOverdue = clients.filter((cl) => {
    if (cl.status === 'overdue') return true
    const cycle = cycleByClientId[cl.id]
    if (!cycle) return false
    return new Date(cycle.period_end) < today && cycle.payment_status === 'unpaid'
  }).length

  // MRR (paid this month)
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]
  const lastOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0]
  let mrrCobrado = 0
  let ingresosPendientes = 0
  for (const cycle of currentCycles) {
    const plan = plansMap[cycle.plan_id_snapshot]
    if (!plan) continue
    if (
      cycle.payment_status === 'paid' &&
      cycle.payment_date &&
      cycle.payment_date >= firstOfMonth &&
      cycle.payment_date <= lastOfMonth
    ) {
      mrrCobrado += plan.price_usd
    }
    if (cycle.payment_status === 'unpaid') {
      ingresosPendientes += plan.price_usd
    }
  }

  // Production totals (sum across all active cycles per type)
  const productionTotals: Record<ContentType, number> = {
    historia: 0, estatico: 0, video_corto: 0, reel: 0,
    short: 0, produccion: 0, reunion: 0, matriz_contenido: 0,
  }
  const productionLimits: Record<ContentType, number> = {
    historia: 0, estatico: 0, video_corto: 0, reel: 0,
    short: 0, produccion: 0, reunion: 0, matriz_contenido: 0,
  }
  for (const cycle of currentCycles) {
    const cons = consByCycleId[cycle.id] ?? []
    const totals = computeTotals(cons)
    const limits = effectiveLimits(cycle.limits_snapshot_json, cycle.rollover_from_previous_json)
    for (const t of CONTENT_TYPES) {
      productionTotals[t] += totals[t]
      productionLimits[t] += limits[t]
    }
  }
  const productionActiveTypes = CONTENT_TYPES.filter((t) => productionLimits[t] > 0)

  // Per-client data for list + CSV
  interface ClientRow {
    id: string
    name: string
    planName: string
    totalConsumed: number
    totalLimits: number
    progressPct: number
    paymentStatus: string
    daysLeft: number | null
  }
  const clientRows: ClientRow[] = []
  for (const cl of clients.filter((c) => c.status === 'active')) {
    const cycle = cycleByClientId[cl.id]
    if (!cycle) continue
    const cons = consByCycleId[cycle.id] ?? []
    const totals = computeTotals(cons)
    const limits = effectiveLimits(cycle.limits_snapshot_json, cycle.rollover_from_previous_json)
    const activeTypes = CONTENT_TYPES.filter((t) => limits[t] > 0)
    const totalConsumed = activeTypes.reduce((sum, t) => sum + totals[t], 0)
    const totalLimits = activeTypes.reduce((sum, t) => sum + limits[t], 0)
    const progressPct = totalLimits > 0 ? Math.min(100, Math.round((totalConsumed / totalLimits) * 100)) : 0
    const daysLeft = daysUntilEnd(cycle.period_end)
    const planName = plansMap[cycle.plan_id_snapshot]?.name ?? 'Plan'
    clientRows.push({
      id: cl.id,
      name: cl.name,
      planName,
      totalConsumed,
      totalLimits,
      progressPct,
      paymentStatus: cycle.payment_status,
      daysLeft,
    })
  }

  // CSV for internal report
  const now = new Date()
  const csvFilename = `reporte-gestion-${MONTHS_SHORT[now.getMonth()]}-${now.getFullYear()}.csv`
  const csvHeaders = ['Cliente', 'Plan', 'Consumido Total', 'Límite Total', '% Consumo', 'Estado Pago', 'Días Restantes']
  const csvRows = clientRows.map((row) => [
    row.name,
    row.planName,
    String(row.totalConsumed),
    String(row.totalLimits),
    `${row.progressPct}%`,
    row.paymentStatus === 'paid' ? 'Pagado' : 'Sin pago',
    row.daysLeft === null ? 'N/A' : row.daysLeft < 0 ? 'Vencido' : String(row.daysLeft),
  ])

  const cycleMonth = `${MONTHS_FULL[now.getMonth()]} ${now.getFullYear()}`

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Reportes" />

      <div className="flex-1 p-6 space-y-8 max-w-6xl mx-auto w-full">
        <div className="flex items-center justify-between pt-2">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-[#2c2f31]">Gestión interna</h1>
            <p className="text-sm text-[#595c5e] mt-1">{cycleMonth}</p>
          </div>
          <div className="flex items-center gap-3">
            {csvRows.length > 0 && (
              <CsvDownloadButton
                headers={csvHeaders}
                rows={csvRows}
                filename={csvFilename}
                label="Exportar CSV"
              />
            )}
          </div>
        </div>

        {/* ── Section 1: Summary cards ── */}
        <AccordionSection title="Indicadores clave" subtitle={cycleMonth} defaultOpen>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Clientes activos', value: totalActive, color: '#00675c' },
              { label: 'Clientes pausados', value: totalPaused, color: '#595c5e' },
              { label: 'Clientes morosos', value: totalOverdue, color: '#b31b25' },
              { label: 'MRR cobrado', value: `$${mrrCobrado.toLocaleString('en-US', { minimumFractionDigits: 0 })}`, color: '#00675c' },
              { label: 'Pendiente cobro', value: `$${ingresosPendientes.toLocaleString('en-US', { minimumFractionDigits: 0 })}`, color: ingresosPendientes > 0 ? '#b31b25' : '#595c5e' },
            ].map((card) => (
              <div key={card.label} className="rounded-2xl bg-[#f5f7f9] border border-[#dfe3e6] p-5 space-y-2">
                <p className="text-[11px] font-extrabold uppercase tracking-wider text-[#595c5e]">{card.label}</p>
                <p className="text-3xl font-black" style={{ color: card.color }}>{card.value}</p>
              </div>
            ))}
          </div>
        </AccordionSection>

        {/* ── Section 2: Production totals ── */}
        {productionActiveTypes.length > 0 && (
          <AccordionSection title={`Producción total — ${cycleMonth}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#dfe3e6]">
                    <th className="text-left py-2 pr-4 font-extrabold text-[#595c5e] uppercase text-xs tracking-wider">Tipo</th>
                    <th className="text-right py-2 px-4 font-extrabold text-[#595c5e] uppercase text-xs tracking-wider">Consumido</th>
                    <th className="text-right py-2 px-4 font-extrabold text-[#595c5e] uppercase text-xs tracking-wider">Límite total</th>
                    <th className="text-right py-2 pl-4 font-extrabold text-[#595c5e] uppercase text-xs tracking-wider">% Agregado</th>
                    <th className="py-2 pl-4 w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {productionActiveTypes.map((type) => {
                    const consumed = productionTotals[type]
                    const limit = productionLimits[type]
                    const pct = limit > 0 ? Math.min(100, Math.round((consumed / limit) * 100)) : 0
                    const color = barColor(pct)
                    return (
                      <tr key={type} className="border-b border-[#f0f3f5] hover:bg-[#f5f7f9] transition-colors">
                        <td className="py-3 pr-4 font-semibold text-[#2c2f31]">{CONTENT_TYPE_LABELS[type]}</td>
                        <td className="py-3 px-4 text-right font-extrabold text-[#2c2f31]">{consumed}</td>
                        <td className="py-3 px-4 text-right text-[#595c5e]">{limit}</td>
                        <td className="py-3 pl-4 text-right font-bold" style={{ color }}>{pct}%</td>
                        <td className="py-3 pl-4">
                          <div className="w-full bg-[#e5e9eb] rounded-full h-1.5 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </AccordionSection>
        )}

        {/* ── Section 3: Pipeline summary ── */}
        <AccordionSection title="Resumen de pipeline">
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {PHASES.map((phase) => {
              const count = pipelineCountByPhase[phase] ?? 0
              return (
                <div
                  key={phase}
                  className="flex flex-col items-center gap-2 p-4 bg-[#f5f7f9] rounded-2xl border border-[#dfe3e6] text-center"
                >
                  <span
                    className="text-2xl font-black"
                    style={{ color: count > 0 ? '#00675c' : '#abadaf' }}
                  >
                    {count}
                  </span>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#595c5e] leading-tight">
                    {PHASE_LABELS[phase]}
                  </span>
                </div>
              )
            })}
          </div>
        </AccordionSection>

        {/* ── Section 4: Client list ── */}
        <AccordionSection title={`Clientes activos (${clientRows.length})`}>
          {clientRows.length === 0 ? (
            <p className="text-sm text-[#595c5e]">No hay clientes activos con ciclo en curso.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#dfe3e6]">
                    <th className="text-left py-2 pr-4 font-extrabold text-[#595c5e] uppercase text-xs tracking-wider">Cliente</th>
                    <th className="text-left py-2 px-4 font-extrabold text-[#595c5e] uppercase text-xs tracking-wider">Plan</th>
                    <th className="text-left py-2 px-4 font-extrabold text-[#595c5e] uppercase text-xs tracking-wider">Progreso</th>
                    <th className="text-left py-2 px-4 font-extrabold text-[#595c5e] uppercase text-xs tracking-wider">Pago</th>
                    <th className="text-right py-2 pl-4 font-extrabold text-[#595c5e] uppercase text-xs tracking-wider">Días</th>
                  </tr>
                </thead>
                <tbody>
                  {clientRows.map((row) => {
                    const daysColor =
                      row.daysLeft === null ? '#595c5e'
                      : row.daysLeft < 0 ? '#b31b25'
                      : row.daysLeft <= 3 ? '#f59e0b'
                      : '#00675c'
                    const daysLabel =
                      row.daysLeft === null ? '—'
                      : row.daysLeft < 0 ? 'Vencido'
                      : row.daysLeft === 0 ? 'Hoy'
                      : String(row.daysLeft)
                    return (
                      <tr key={row.id} className="border-b border-[#f0f3f5] hover:bg-[#f5f7f9] transition-colors">
                        <td className="py-3 pr-4">
                          <a
                            href={`/clients/${row.id}`}
                            className="font-bold text-[#2c2f31] hover:text-[#00675c] transition-colors"
                          >
                            {row.name}
                          </a>
                        </td>
                        <td className="py-3 px-4 text-[#595c5e]">{row.planName}</td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2 min-w-[120px]">
                            <div className="flex-1 bg-[#e5e9eb] rounded-full h-1.5 overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${row.progressPct}%`,
                                  backgroundColor: barColor(row.progressPct),
                                }}
                              />
                            </div>
                            <span className="text-xs text-[#595c5e] whitespace-nowrap">
                              {row.totalConsumed}/{row.totalLimits}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {row.paymentStatus === 'paid' ? (
                            <span className="px-2.5 py-1 bg-[#ceee93] text-[#41590f] text-[10px] font-extrabold rounded-full uppercase">
                              Pagado
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 bg-[#b31b25]/10 text-[#b31b25] text-[10px] font-extrabold rounded-full uppercase">
                              Sin pago
                            </span>
                          )}
                        </td>
                        <td className="py-3 pl-4 text-right font-bold" style={{ color: daysColor }}>
                          {daysLabel}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </AccordionSection>

        {/* ── Section 5: Informes de hojas de tiempo ── */}
        <AccordionSection title="Informes de hojas de tiempo">
          <TimesheetReport
            users={(usersList ?? []).map(u => ({ id: u.id, full_name: u.full_name, avatar_url: u.avatar_url }))}
            clients={clientsList ?? []}
            currentUserId={authUser.id}
          />
        </AccordionSection>

        {/* ── Section 6: Tiempo por requerimiento × fase ── */}
        <AccordionSection title="Tiempo por requerimiento y fase">
          <TimeByRequirementPhaseReport
            users={(usersList ?? []).map(u => ({ id: u.id, full_name: u.full_name }))}
            clients={clientsList ?? []}
          />
        </AccordionSection>

        {/* Empty state — no cycles at all */}
        {currentCycles.length === 0 && (
          <div className="glass-panel rounded-[2rem] p-8 text-center">
            <p className="text-[#595c5e] text-sm">No hay ciclos activos registrados.</p>
          </div>
        )}
      </div>
    </div>
  )
}
