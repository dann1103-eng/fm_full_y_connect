'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { fetchRequirementCycleStats } from '@/app/actions/fetchRequirementCycleStats'
import type { RequirementCycleRow, CycleAggregates } from '@/lib/domain/requirementCycle'
import { formatDuration, formatDurationHMS } from '@/lib/domain/time'
import { PHASES, PHASE_LABELS } from '@/lib/domain/pipeline'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import type { Phase, ContentType } from '@/types/db'
import { DateRangePicker, monthRange, type DateRangeValue } from '@/components/ui/DateRangePicker'
import { CsvDownloadButton } from './CsvDownloadButton'

interface Props {
  // `users` kept for backward compatibility with the reports page; ignored here
  // (the new view filters only by client + requirement, per product decision).
  users?: { id: string; full_name: string }[]
  clients: { id: string; name: string }[]
}

function fmt(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  return formatDurationHMS(seconds)
}

function fmtShort(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  return formatDuration(seconds)
}

export function TimeByRequirementPhaseReport({ clients }: Props) {
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => monthRange())
  const [clientFilter, setClientFilter] = useState<string>('')
  const [requirementFilter, setRequirementFilter] = useState<string>('')

  const [rows, setRows] = useState<RequirementCycleRow[]>([])
  const [aggregates, setAggregates] = useState<CycleAggregates | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const loading = isPending

  useEffect(() => {
    let cancelled = false
    startTransition(() => {
      fetchRequirementCycleStats({
        startIso: dateRange.start,
        endIso: dateRange.end,
        clientId: clientFilter || undefined,
        requirementId: requirementFilter || undefined,
      }).then((res) => {
        if (cancelled) return
        if (res.error) {
          setError(res.error)
          setRows([])
          setAggregates(null)
        } else {
          setError(null)
          setRows(res.rows ?? [])
          setAggregates(res.aggregates ?? null)
        }
      })
    })
    return () => { cancelled = true }
  }, [dateRange, clientFilter, requirementFilter])

  // Requirement picker options: derive from currently visible rows so it auto-narrows to the client.
  // To keep it useful BEFORE data loads, we fetch a minimal list by reusing the current rows state.
  const reqOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows) {
      if (clientFilter && r.client_id !== clientFilter) continue
      map.set(r.requirement_id, `${r.requirement_title} · ${r.client_name}`)
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }))
  }, [rows, clientFilter])

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => (b.total_cycle_seconds ?? 0) - (a.total_cycle_seconds ?? 0))
  }, [rows])

  const activePhases = useMemo(() => {
    const seen = new Set<Phase>()
    for (const r of rows) {
      for (const p of PHASES) {
        if (r.phases[p]) seen.add(p)
      }
    }
    return PHASES.filter((p) => seen.has(p))
  }, [rows])

  const [showPhaseBreakdown, setShowPhaseBreakdown] = useState(false)

  const csvData = useMemo(() => {
    const headers = [
      'Cliente', 'Requerimiento', 'Tipo', 'Fase actual',
      'Total ciclo', 'Primer movimiento', 'Primer trabajo',
      ...activePhases.flatMap((p) => [
        `${PHASE_LABELS[p]} · standby`,
        `${PHASE_LABELS[p]} · trabajado`,
        `${PHASE_LABELS[p]} · total`,
      ]),
    ]
    const csvRows = sortedRows.map((r) => [
      r.client_name,
      r.requirement_title,
      r.content_type ? CONTENT_TYPE_LABELS[r.content_type] : '—',
      PHASE_LABELS[r.current_phase],
      fmt(r.total_cycle_seconds),
      fmt(r.first_move_seconds),
      fmt(r.first_work_seconds),
      ...activePhases.flatMap((p) => {
        const pt = r.phases[p]
        return pt
          ? [fmtShort(pt.standby_seconds), fmtShort(pt.worked_seconds), fmtShort(pt.total_seconds)]
          : ['—', '—', '—']
      }),
    ])
    return { headers, csvRows }
  }, [sortedRows, activePhases])

  const dateRangeLabel = `${new Date(dateRange.start).toISOString().slice(0, 10)}_${new Date(dateRange.end).toISOString().slice(0, 10)}`

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <DateRangePicker value={dateRange} onChange={setDateRange} />

        <label className="flex items-center gap-2">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#595c5e]">Cliente</span>
          <select
            value={clientFilter}
            onChange={(e) => { setClientFilter(e.target.value); setRequirementFilter('') }}
            className="bg-white border border-[#dfe3e6] rounded-full px-3 py-1.5 text-xs font-bold text-[#2c2f31] focus:outline-none focus:border-[#00675c]"
          >
            <option value="">Todos los clientes</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#595c5e]">Requerimiento</span>
          <select
            value={requirementFilter}
            onChange={(e) => setRequirementFilter(e.target.value)}
            disabled={reqOptions.length === 0}
            className="bg-white border border-[#dfe3e6] rounded-full px-3 py-1.5 text-xs font-bold text-[#2c2f31] focus:outline-none focus:border-[#00675c] max-w-[260px] disabled:opacity-50"
          >
            <option value="">Todos</option>
            {reqOptions.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </label>

        {(clientFilter || requirementFilter) && (
          <button
            type="button"
            onClick={() => { setClientFilter(''); setRequirementFilter('') }}
            className="text-xs font-bold text-[#b31b25] hover:underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* KPI cards */}
      {aggregates && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="Ciclo total promedio"
            value={fmt(aggregates.avg_total_cycle_seconds)}
            sub={`${aggregates.count_closed} cerrados`}
            tone="primary"
          />
          <KpiCard
            label="Primer movimiento prom."
            value={fmt(aggregates.avg_first_move_seconds)}
            sub="Ingreso → fuera de pendiente"
          />
          <KpiCard
            label="Primer trabajo prom."
            value={fmt(aggregates.avg_first_work_seconds)}
            sub="Ingreso → primer time entry"
          />
          <KpiCard
            label="Requerimientos"
            value={String(aggregates.count_total)}
            sub={`${aggregates.count_closed} cerrados`}
          />
        </div>
      )}

      {/* Table of requirements */}
      {loading ? (
        <div className="p-8 text-center text-sm text-[#595c5e]">Cargando…</div>
      ) : error ? (
        <div className="p-8 text-center text-sm text-[#b31b25]">{error}</div>
      ) : sortedRows.length === 0 ? (
        <div className="p-8 text-center text-sm text-[#595c5e]">
          Sin requerimientos en el rango seleccionado.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-extrabold text-[#2c2f31]">Por requerimiento</h4>
            <button
              type="button"
              onClick={() => setShowPhaseBreakdown((v) => !v)}
              className="text-xs font-bold text-[#00675c] hover:underline"
            >
              {showPhaseBreakdown ? 'Ocultar desglose por fase' : 'Ver desglose por fase'}
            </button>
          </div>

          {/* Mobile: card list */}
          <div className="sm:hidden space-y-2">
            {sortedRows.map((r) => (
              <div key={r.requirement_id} className="bg-white rounded-xl border border-[#dfe3e6] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm text-[#2c2f31] truncate">{r.requirement_title}</p>
                    <p className="text-xs text-[#595c5e] truncate">{r.client_name}</p>
                  </div>
                  {r.is_closed && (
                    <span className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 flex-shrink-0">
                      Cerrado
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-[#abadaf]">Tipo</p>
                    <p className="font-medium text-[#2c2f31]">
                      {r.content_type ? CONTENT_TYPE_LABELS[r.content_type] : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-[#abadaf]">Fase actual</p>
                    <p className="font-medium text-[#2c2f31]">{PHASE_LABELS[r.current_phase]}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-[#abadaf]">Total ciclo</p>
                    <p className="font-extrabold tabular-nums text-[#00675c]">{fmt(r.total_cycle_seconds)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-[#abadaf]">1er mov.</p>
                    <p className="font-medium tabular-nums text-[#2c2f31]">{fmt(r.first_move_seconds)}</p>
                  </div>
                  <div>
                    <p className="text-[9px] uppercase tracking-wider text-[#abadaf]">1er trabajo</p>
                    <p className="font-medium tabular-nums text-[#2c2f31]">{fmt(r.first_work_seconds)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-[#dfe3e6]">
                  <Th>Cliente</Th>
                  <Th>Requerimiento</Th>
                  <Th className="whitespace-nowrap">Tipo</Th>
                  <Th className="whitespace-nowrap">Fase actual</Th>
                  <Th align="right">Total ciclo</Th>
                  <Th align="right">1er mov.</Th>
                  <Th align="right">1er trabajo</Th>
                  {showPhaseBreakdown && activePhases.map((p) => (
                    <Th key={p} align="right" className="whitespace-nowrap">{PHASE_LABELS[p]}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr key={r.requirement_id} className="border-b border-[#f0f3f5] hover:bg-[#f5f7f9] transition-colors">
                    <td className="py-2 pr-3 text-[#595c5e] text-xs whitespace-nowrap">{r.client_name}</td>
                    <td className="py-2 px-3 font-semibold text-[#2c2f31]">
                      {r.requirement_title}
                      {r.is_closed && (
                        <span className="ml-2 inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">
                          Cerrado
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-[#595c5e] text-xs whitespace-nowrap">
                      {r.content_type ? CONTENT_TYPE_LABELS[r.content_type] : '—'}
                    </td>
                    <td className="py-2 px-3 text-[#595c5e] text-xs whitespace-nowrap">
                      {PHASE_LABELS[r.current_phase]}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums font-extrabold text-[#00675c] whitespace-nowrap">
                      {fmt(r.total_cycle_seconds)}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums text-xs text-[#2c2f31] whitespace-nowrap">
                      {fmt(r.first_move_seconds)}
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums text-xs text-[#2c2f31] whitespace-nowrap">
                      {fmt(r.first_work_seconds)}
                    </td>
                    {showPhaseBreakdown && activePhases.map((p) => {
                      const pt = r.phases[p]
                      if (!pt) {
                        return <td key={p} className="py-2 px-2 text-right text-[#dfe3e6] text-xs whitespace-nowrap">—</td>
                      }
                      return (
                        <td
                          key={p}
                          className="py-2 px-2 text-right tabular-nums text-xs text-[#2c2f31] whitespace-nowrap"
                          title={`Standby: ${fmtShort(pt.standby_seconds)} · Trabajado: ${fmtShort(pt.worked_seconds)}`}
                        >
                          <div className="font-bold">{fmtShort(pt.total_seconds)}</div>
                          <div className="text-[9px] text-[#abadaf] leading-tight">
                            s:{fmtShort(pt.standby_seconds)} · t:{fmtShort(pt.worked_seconds)}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Averages by content type */}
      {aggregates && Object.keys(aggregates.by_type).length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-extrabold text-[#2c2f31]">Promedios por tipo de contenido</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#dfe3e6]">
                  <Th>Tipo</Th>
                  <Th align="right">Reqs</Th>
                  <Th align="right">Ciclo promedio</Th>
                  <Th align="right">Primer mov. promedio</Th>
                </tr>
              </thead>
              <tbody>
                {(Object.entries(aggregates.by_type) as [ContentType, { count: number; avg_cycle: number | null; avg_first_move: number | null }][])
                  .map(([type, agg]) => (
                    <tr key={type} className="border-b border-[#f0f3f5]">
                      <td className="py-2 pr-3 text-[#2c2f31] font-semibold text-xs">{CONTENT_TYPE_LABELS[type]}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-xs text-[#2c2f31]">{agg.count}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-xs text-[#2c2f31]">{fmt(agg.avg_cycle)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-xs text-[#2c2f31]">{fmt(agg.avg_first_move)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Averages by phase */}
      {aggregates && Object.keys(aggregates.by_phase).length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-extrabold text-[#2c2f31]">Promedios por fase</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#dfe3e6]">
                  <Th>Fase</Th>
                  <Th align="right">Reqs que la cruzaron</Th>
                  <Th align="right">Standby promedio</Th>
                  <Th align="right">Trabajado promedio</Th>
                  <Th align="right">Total promedio</Th>
                </tr>
              </thead>
              <tbody>
                {PHASES.filter((p) => aggregates.by_phase[p]).map((p) => {
                  const agg = aggregates.by_phase[p]!
                  const total = agg.avg_standby + agg.avg_worked
                  return (
                    <tr key={p} className="border-b border-[#f0f3f5]">
                      <td className="py-2 pr-3 text-[#2c2f31] font-semibold text-xs">{PHASE_LABELS[p]}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-xs text-[#2c2f31]">{agg.count}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-xs text-[#2c2f31]">{fmtShort(agg.avg_standby)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-xs text-[#2c2f31]">{fmtShort(agg.avg_worked)}</td>
                      <td className="py-2 px-2 text-right tabular-nums text-xs font-bold text-[#00675c]">{fmtShort(total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Export */}
      {sortedRows.length > 0 && (
        <div className="flex flex-wrap gap-3 pt-2">
          <CsvDownloadButton
            headers={csvData.headers}
            rows={csvData.csvRows}
            filename={`analisis-ciclo-requerimiento_${dateRangeLabel}.csv`}
            label="Exportar CSV"
          />
        </div>
      )}
    </div>
  )
}

function KpiCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'primary' }) {
  return (
    <div className={`rounded-2xl p-4 border ${tone === 'primary' ? 'bg-[#00675c]/5 border-[#00675c]/20' : 'bg-white border-[#dfe3e6]'}`}>
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#595c5e]">{label}</p>
      <p className={`text-xl font-black mt-1 tabular-nums ${tone === 'primary' ? 'text-[#00675c]' : 'text-[#2c2f31]'}`}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-[#abadaf] mt-0.5">{sub}</p>}
    </div>
  )
}

function Th({ children, align, className }: { children: React.ReactNode; align?: 'right' | 'left'; className?: string }) {
  return (
    <th
      className={`py-2 ${align === 'right' ? 'text-right px-2' : 'text-left pr-3'} font-extrabold text-[#595c5e] uppercase text-[10px] tracking-wider ${className ?? ''}`}
    >
      {children}
    </th>
  )
}
