// src/app/(app)/clients/[id]/report/page.tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { CsvDownloadButton } from '@/components/reports/CsvDownloadButton'
import { PrintButton } from '@/components/reports/PrintButton'
import type { ClientWithPlan, BillingCycle, Requirement } from '@/types/db'
import { computeTotals } from '@/lib/domain/requirement'
import { effectiveLimits } from '@/lib/domain/plans'
import { daysUntilEnd } from '@/lib/domain/cycles'
import { CONTENT_TYPES, CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import { PIPELINE_CONTENT_TYPES, PHASES, PHASE_LABELS } from '@/lib/domain/pipeline'

export const dynamic = 'force-dynamic'

const MONTHS_SHORT = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
const MONTHS_FULL  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

function formatDateShort(d: string): string {
  const date = new Date(d)
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`
}

function barColor(pct: number): string {
  if (pct >= 90) return '#b31b25'
  if (pct >= 70) return '#f59e0b'
  return '#00675c'
}

export default async function ClientReportPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // 1. Client + plan
  const { data: clientRaw } = await supabase
    .from('clients')
    .select('*, plan:plans(*)')
    .eq('id', id)
    .single()

  if (!clientRaw) notFound()
  const client = clientRaw as ClientWithPlan

  // 2. Current cycle
  const { data: currentCycleRaw } = await supabase
    .from('billing_cycles')
    .select('*')
    .eq('client_id', id)
    .eq('status', 'current')
    .maybeSingle()
  const cycle = currentCycleRaw as BillingCycle | null

  // 3. Past cycles
  const { data: pastCyclesRaw } = await supabase
    .from('billing_cycles')
    .select('*')
    .eq('client_id', id)
    .in('status', ['archived', 'pending_renewal'])
    .order('period_start', { ascending: false })
  const pastCycles = (pastCyclesRaw ?? []) as BillingCycle[]

  // 4. Plans map
  const { data: plansRaw } = await supabase.from('plans').select('id, name')
  const plansMap: Record<string, string> = {}
  for (const p of plansRaw ?? []) plansMap[p.id] = p.name

  // 5. Requirements for current cycle
  const reqs: Requirement[] = []
  if (cycle) {
    const { data: reqsRaw } = await supabase
      .from('requirements')
      .select('*')
      .eq('billing_cycle_id', cycle.id)
    reqs.push(...((reqsRaw ?? []) as Requirement[]))
  }

  // 6. Pipeline items for current cycle
  const pipelineCountByPhase: Record<string, number> = {}
  if (cycle) {
    const { data: pipelineRaw } = await supabase
      .from('requirements')
      .select('id, phase')
      .eq('billing_cycle_id', cycle.id)
      .eq('voided', false)
      .in('content_type', PIPELINE_CONTENT_TYPES)
    for (const item of pipelineRaw ?? []) {
      pipelineCountByPhase[item.phase] = (pipelineCountByPhase[item.phase] ?? 0) + 1
    }
  }

  // Computed values
  const totals = computeTotals(reqs)
  const limits = cycle
    ? effectiveLimits(cycle.limits_snapshot_json, cycle.rollover_from_previous_json)
    : null
  const daysLeft = cycle ? daysUntilEnd(cycle.period_end) : null
  const activeTypes = CONTENT_TYPES.filter((t) => limits && limits[t] > 0)

  // CSV rows for content requirements
  const csvHeaders = ['Tipo', 'Consumido', 'Límite', 'Restante', '% Usado']
  const csvRows = activeTypes.map((t) => {
    const consumed = totals[t]
    const limit = limits![t]
    const remaining = Math.max(0, limit - consumed)
    const pct = limit > 0 ? Math.round((consumed / limit) * 100) : 0
    return [CONTENT_TYPE_LABELS[t], String(consumed), String(limit), String(remaining), `${pct}%`]
  })

  // Cycle display helpers
  const cycleStart = cycle ? new Date(cycle.period_start) : null
  const cycleMonthLabel = cycleStart
    ? `${MONTHS_FULL[cycleStart.getMonth()]} ${cycleStart.getFullYear()}`
    : ''
  const csvFilename = cycle && cycleStart
    ? `reporte-${client.name.toLowerCase().replace(/\s+/g, '-')}-${MONTHS_SHORT[cycleStart.getMonth()]}-${cycleStart.getFullYear()}.csv`
    : `reporte-${client.name.toLowerCase().replace(/\s+/g, '-')}.csv`

  const STATUS_LABELS: Record<string, string> = { active: 'Activo', paused: 'Pausado', overdue: 'Moroso' }

  return (
    <div className="flex flex-col h-full">
      {/* Print CSS */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white; }
          .glass-panel { box-shadow: none !important; border: 1px solid #dfe3e6 !important; }
          aside, nav { display: none !important; }
        }
      `}</style>

      <TopNav title={`Reporte — ${client.name}`} />

      <div className="flex-1 p-6 space-y-8 max-w-5xl mx-auto w-full">
        {/* Breadcrumb */}
        <nav className="no-print flex items-center gap-2 text-sm pt-2">
          <Link
            href={`/clients/${client.id}`}
            className="text-[#595c5e] flex items-center gap-1 hover:text-[#00675c] transition-colors"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            {client.name}
          </Link>
          <span className="text-[#abadaf]">/</span>
          <span className="font-semibold text-[#2c2f31]">Reporte</span>
        </nav>

        {/* ── Section 1: Header ── */}
        <section className="glass-panel rounded-[2rem] p-8 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-extrabold tracking-tight text-[#2c2f31]">
                  {client.name}
                </h1>
                <span className="px-3 py-1 bg-[#ceee93]/50 text-[#4a6319] text-xs font-extrabold rounded-full uppercase tracking-wider">
                  Plan {client.plan.name}
                </span>
                <span className="px-3 py-1 bg-[#eef1f3] text-[#595c5e] text-xs font-extrabold rounded-full uppercase tracking-wider">
                  {STATUS_LABELS[client.status] ?? client.status}
                </span>
              </div>

              {cycle ? (
                <div className="text-sm text-[#595c5e] space-y-1">
                  <p>
                    <span className="font-semibold text-[#2c2f31]">Período:</span>{' '}
                    {formatDateShort(cycle.period_start)} – {formatDateShort(cycle.period_end)}{' '}
                    {cycleStart && `${cycleStart.getFullYear()}`}
                  </p>
                  <p>
                    <span className="font-semibold text-[#2c2f31]">Pago:</span>{' '}
                    {cycle.payment_status === 'paid' ? (
                      <span className="text-[#00675c] font-bold">Pagado</span>
                    ) : (
                      <span className="text-[#b31b25] font-bold">Sin pago</span>
                    )}
                  </p>
                  {daysLeft !== null && (
                    <p>
                      <span className="font-semibold text-[#2c2f31]">Ciclo:</span>{' '}
                      <span
                        className="font-bold"
                        style={{
                          color: daysLeft < 0 ? '#b31b25' : daysLeft <= 3 ? '#f59e0b' : '#00675c',
                        }}
                      >
                        {daysLeft < 0
                          ? 'Vencido'
                          : daysLeft === 0
                          ? 'Vence hoy'
                          : `${daysLeft} días restantes`}
                      </span>
                    </p>
                  )}
                  <p className="text-xs text-[#abadaf] pt-1">
                    Generado el {new Date().toLocaleDateString('es-SV', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-[#595c5e]">Sin ciclo activo</p>
              )}
            </div>

            {/* Action buttons */}
            <div className="no-print flex items-center gap-3 flex-shrink-0">
              <PrintButton />
              {csvRows.length > 0 && (
                <CsvDownloadButton
                  headers={csvHeaders}
                  rows={csvRows}
                  filename={csvFilename}
                  label="Descargar CSV"
                />
              )}
            </div>
          </div>
        </section>

        {/* ── Section 2: Consumo por tipo ── */}
        {cycle && limits && activeTypes.length > 0 && (
          <section className="glass-panel rounded-[2rem] p-8 space-y-5">
            <h2 className="text-xl font-extrabold tracking-tight text-[#2c2f31]">
              Requerimientos por tipo — {cycleMonthLabel}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#dfe3e6]">
                    <th className="text-left py-2 pr-4 font-extrabold text-[#595c5e] uppercase text-xs tracking-wider">Tipo</th>
                    <th className="text-right py-2 px-4 font-extrabold text-[#595c5e] uppercase text-xs tracking-wider">Registrado</th>
                    <th className="text-right py-2 px-4 font-extrabold text-[#595c5e] uppercase text-xs tracking-wider">Límite</th>
                    <th className="text-right py-2 px-4 font-extrabold text-[#595c5e] uppercase text-xs tracking-wider">Restante</th>
                    <th className="text-right py-2 pl-4 font-extrabold text-[#595c5e] uppercase text-xs tracking-wider">% Usado</th>
                    <th className="py-2 pl-4 w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {activeTypes.map((type) => {
                    const consumed = totals[type]
                    const limit = limits[type]
                    const remaining = Math.max(0, limit - consumed)
                    const pct = limit > 0 ? Math.min(100, Math.round((consumed / limit) * 100)) : 0
                    const color = barColor(pct)
                    return (
                      <tr key={type} className="border-b border-[#f0f3f5] hover:bg-[#f5f7f9] transition-colors">
                        <td className="py-3 pr-4 font-semibold text-[#2c2f31]">{CONTENT_TYPE_LABELS[type]}</td>
                        <td className="py-3 px-4 text-right font-extrabold text-[#2c2f31]">{consumed}</td>
                        <td className="py-3 px-4 text-right text-[#595c5e]">{limit}</td>
                        <td className="py-3 px-4 text-right" style={{ color: remaining === 0 ? '#b31b25' : '#595c5e' }}>
                          {remaining}
                        </td>
                        <td className="py-3 pl-4 text-right font-bold" style={{ color }}>{pct}%</td>
                        <td className="py-3 pl-4">
                          <div className="w-full bg-[#e5e9eb] rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, backgroundColor: color }}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Section 3: Pipeline ── */}
        {cycle && Object.keys(pipelineCountByPhase).length > 0 && (
          <section className="glass-panel rounded-[2rem] p-8 space-y-5">
            <h2 className="text-xl font-extrabold tracking-tight text-[#2c2f31]">Estado del pipeline</h2>
            <div className="flex flex-wrap gap-3">
              {PHASES.filter((phase) => (pipelineCountByPhase[phase] ?? 0) > 0).map((phase) => (
                <div
                  key={phase}
                  className="flex items-center gap-2 px-4 py-2.5 bg-[#f5f7f9] rounded-2xl border border-[#dfe3e6]"
                >
                  <span className="text-sm font-semibold text-[#595c5e]">{PHASE_LABELS[phase]}</span>
                  <span className="min-w-[24px] text-center px-2 py-0.5 bg-[#00675c] text-white text-xs font-extrabold rounded-full">
                    {pipelineCountByPhase[phase]}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Section 4: Cycle history ── */}
        {pastCycles.length > 0 && (
          <section className="glass-panel rounded-[2rem] p-8 space-y-5">
            <h2 className="text-xl font-extrabold tracking-tight text-[#2c2f31]">Historial de ciclos</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#dfe3e6]">
                    <th className="text-left py-2 pr-4 font-extrabold text-[#595c5e] uppercase text-xs tracking-wider">Período</th>
                    <th className="text-left py-2 px-4 font-extrabold text-[#595c5e] uppercase text-xs tracking-wider">Plan</th>
                    <th className="text-left py-2 pl-4 font-extrabold text-[#595c5e] uppercase text-xs tracking-wider">Pago</th>
                  </tr>
                </thead>
                <tbody>
                  {pastCycles.map((c) => {
                    const start = new Date(c.period_start)
                    const end = new Date(c.period_end)
                    const periodLabel = `${MONTHS_FULL[start.getMonth()]} ${start.getFullYear()}`
                    const endLabel = `${MONTHS_FULL[end.getMonth()]} ${end.getFullYear()}`
                    const isSameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
                    return (
                      <tr key={c.id} className="border-b border-[#f0f3f5] hover:bg-[#f5f7f9] transition-colors">
                        <td className="py-3 pr-4 font-semibold text-[#2c2f31]">
                          {isSameMonth ? periodLabel : `${periodLabel} – ${endLabel}`}
                        </td>
                        <td className="py-3 px-4 text-[#595c5e]">{plansMap[c.plan_id_snapshot] ?? 'Plan'}</td>
                        <td className="py-3 pl-4">
                          {c.payment_status === 'paid' ? (
                            <span className="px-2.5 py-1 bg-[#ceee93] text-[#41590f] text-[10px] font-extrabold rounded-full uppercase">
                              Pagado
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 bg-[#b31b25]/10 text-[#b31b25] text-[10px] font-extrabold rounded-full uppercase">
                              Sin pago
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Empty state */}
        {!cycle && pastCycles.length === 0 && (
          <div className="glass-panel rounded-[2rem] p-8 text-center">
            <p className="text-[#595c5e] text-sm">No hay datos de ciclos para este cliente.</p>
          </div>
        )}
      </div>
    </div>
  )
}
