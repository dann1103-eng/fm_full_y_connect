'use client'

import { useEffect, useMemo, useState } from 'react'
import { fetchTimesheetEntries } from '@/app/actions/fetchTimesheet'
import type { TimesheetEntry } from '@/lib/domain/timesheet'
import { formatDuration, formatDurationHMS } from '@/lib/domain/time'
import { PHASES, PHASE_LABELS } from '@/lib/domain/pipeline'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import type { Phase, ContentType } from '@/types/db'
import { DateRangePicker, monthRange, type DateRangeValue } from '@/components/ui/DateRangePicker'
import { CsvDownloadButton } from './CsvDownloadButton'

interface Props {
  users: { id: string; full_name: string }[]
  clients: { id: string; name: string }[]
}

interface RequirementAgg {
  requirement_id: string
  requirement_title: string
  client_id: string | null
  client_name: string
  content_type: ContentType | null
  phases: Partial<Record<Phase, number>>
  total_seconds: number
}

export function TimeByRequirementPhaseReport({ users, clients }: Props) {
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => monthRange())
  const [userFilter, setUserFilter] = useState<string>('')
  const [clientFilter, setClientFilter] = useState<string>('')

  const [entries, setEntries] = useState<TimesheetEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchTimesheetEntries({
      startIso: dateRange.start,
      endIso: dateRange.end,
      entryType: 'requirement',
      userIds: userFilter ? [userFilter] : undefined,
      clientIds: clientFilter ? [clientFilter] : undefined,
    }).then((res) => {
      if (cancelled) return
      if (res.error) {
        setError(res.error)
        setEntries([])
      } else {
        setEntries(res.entries ?? [])
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [dateRange, userFilter, clientFilter])

  const { rows, phaseTotals, grandTotal, activePhases } = useMemo(() => {
    const map = new Map<string, RequirementAgg>()
    for (const e of entries) {
      if (!e.requirement_id) continue
      let agg = map.get(e.requirement_id)
      if (!agg) {
        agg = {
          requirement_id: e.requirement_id,
          requirement_title: e.requirement_title ?? e.title ?? '— Sin título —',
          client_id: e.client_id,
          client_name: e.client_name ?? 'Interno FM',
          content_type: null,
          phases: {},
          total_seconds: 0,
        }
        map.set(e.requirement_id, agg)
      }
      const phase = e.phase as Phase | null
      if (phase) {
        agg.phases[phase] = (agg.phases[phase] ?? 0) + (e.duration_seconds || 0)
      }
      agg.total_seconds += e.duration_seconds || 0
    }

    const rows = Array.from(map.values()).sort((a, b) => b.total_seconds - a.total_seconds)

    const phaseTotals: Partial<Record<Phase, number>> = {}
    let grandTotal = 0
    for (const r of rows) {
      for (const p of PHASES) {
        const v = r.phases[p] ?? 0
        if (v > 0) phaseTotals[p] = (phaseTotals[p] ?? 0) + v
      }
      grandTotal += r.total_seconds
    }

    const activePhases = PHASES.filter((p) => (phaseTotals[p] ?? 0) > 0)

    return { rows, phaseTotals, grandTotal, activePhases }
  }, [entries])

  // Optional: fetch requirement content_type for each unique id (cheap — one query)
  const [contentTypeMap, setContentTypeMap] = useState<Record<string, ContentType>>({})
  useEffect(() => {
    const ids = Array.from(new Set(entries.map((e) => e.requirement_id).filter((x): x is string => !!x)))
    if (ids.length === 0) {
      setContentTypeMap({})
      return
    }
    let cancelled = false
    import('@/lib/supabase/client').then(({ createClient }) => {
      const supabase = createClient()
      supabase
        .from('requirements')
        .select('id, content_type')
        .in('id', ids)
        .then(({ data }) => {
          if (cancelled) return
          const m: Record<string, ContentType> = {}
          for (const r of data ?? []) m[r.id] = r.content_type as ContentType
          setContentTypeMap(m)
        })
    })
    return () => { cancelled = true }
  }, [entries])

  const csvData = useMemo(() => {
    const headers = ['Cliente', 'Requerimiento', 'Tipo', ...activePhases.map((p) => PHASE_LABELS[p]), 'Total']
    const csvRows = rows.map((r) => {
      const ct = contentTypeMap[r.requirement_id]
      return [
        r.client_name,
        r.requirement_title,
        ct ? CONTENT_TYPE_LABELS[ct] : '—',
        ...activePhases.map((p) => formatDurationHMS(r.phases[p] ?? 0)),
        formatDurationHMS(r.total_seconds),
      ]
    })
    return { headers, csvRows }
  }, [rows, activePhases, contentTypeMap])

  const dateRangeLabel = `${new Date(dateRange.start).toISOString().slice(0,10)}_${new Date(dateRange.end).toISOString().slice(0,10)}`

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <DateRangePicker value={dateRange} onChange={setDateRange} />

        <label className="flex items-center gap-2">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#595c5e]">Miembro</span>
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="bg-white border border-[#dfe3e6] rounded-full px-3 py-1.5 text-xs font-bold text-[#2c2f31] focus:outline-none focus:border-[#00675c]"
          >
            <option value="">Todos</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.full_name}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#595c5e]">Cliente</span>
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="bg-white border border-[#dfe3e6] rounded-full px-3 py-1.5 text-xs font-bold text-[#2c2f31] focus:outline-none focus:border-[#00675c]"
          >
            <option value="">Todos</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>

        {(userFilter || clientFilter) && (
          <button
            type="button"
            onClick={() => { setUserFilter(''); setClientFilter('') }}
            className="text-xs font-bold text-[#b31b25] hover:underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-white border border-[#dfe3e6] rounded-2xl p-4">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#595c5e]">Total</p>
          <p className="text-xl font-black text-[#2c2f31] mt-1 tabular-nums">{formatDurationHMS(grandTotal)}</p>
        </div>
        <div className="bg-white border border-[#dfe3e6] rounded-2xl p-4">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#595c5e]">Requerimientos</p>
          <p className="text-xl font-black text-[#2c2f31] mt-1 tabular-nums">{rows.length}</p>
        </div>
        <div className="bg-white border border-[#dfe3e6] rounded-2xl p-4">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#595c5e]">Fases con tiempo</p>
          <p className="text-xl font-black text-[#2c2f31] mt-1 tabular-nums">{activePhases.length}</p>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="p-8 text-center text-sm text-[#595c5e]">Cargando…</div>
      ) : error ? (
        <div className="p-8 text-center text-sm text-[#b31b25]">{error}</div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-[#595c5e]">
          Sin entradas de tiempo con requerimiento en el rango seleccionado.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b-2 border-[#dfe3e6]">
                <th className="text-left py-2 pr-3 font-extrabold text-[#595c5e] uppercase text-[10px] tracking-wider whitespace-nowrap">Cliente</th>
                <th className="text-left py-2 px-3 font-extrabold text-[#595c5e] uppercase text-[10px] tracking-wider">Requerimiento</th>
                <th className="text-left py-2 px-3 font-extrabold text-[#595c5e] uppercase text-[10px] tracking-wider whitespace-nowrap">Tipo</th>
                {activePhases.map((p) => (
                  <th
                    key={p}
                    className="text-right py-2 px-2 font-extrabold text-[#595c5e] uppercase text-[10px] tracking-wider whitespace-nowrap"
                  >
                    {PHASE_LABELS[p]}
                  </th>
                ))}
                <th className="text-right py-2 pl-3 font-extrabold text-[#00675c] uppercase text-[10px] tracking-wider whitespace-nowrap">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ct = contentTypeMap[r.requirement_id]
                return (
                  <tr key={r.requirement_id} className="border-b border-[#f0f3f5] hover:bg-[#f5f7f9] transition-colors">
                    <td className="py-2 pr-3 text-[#595c5e] text-xs whitespace-nowrap">{r.client_name}</td>
                    <td className="py-2 px-3 font-semibold text-[#2c2f31]">{r.requirement_title}</td>
                    <td className="py-2 px-3 text-[#595c5e] text-xs whitespace-nowrap">
                      {ct ? CONTENT_TYPE_LABELS[ct] : '—'}
                    </td>
                    {activePhases.map((p) => {
                      const v = r.phases[p] ?? 0
                      return (
                        <td
                          key={p}
                          className={`py-2 px-2 text-right tabular-nums text-xs whitespace-nowrap ${
                            v > 0 ? 'text-[#2c2f31]' : 'text-[#dfe3e6]'
                          }`}
                        >
                          {v > 0 ? formatDuration(v) : '—'}
                        </td>
                      )
                    })}
                    <td className="py-2 pl-3 text-right font-extrabold text-[#00675c] tabular-nums whitespace-nowrap">
                      {formatDurationHMS(r.total_seconds)}
                    </td>
                  </tr>
                )
              })}
              {/* Totals row */}
              <tr className="border-t-2 border-[#dfe3e6] bg-[#f5f7f9]">
                <td className="py-2 pr-3 font-extrabold text-[#2c2f31] uppercase text-[10px] tracking-wider" colSpan={3}>
                  Total por fase
                </td>
                {activePhases.map((p) => (
                  <td
                    key={p}
                    className="py-2 px-2 text-right tabular-nums text-xs font-bold text-[#2c2f31] whitespace-nowrap"
                  >
                    {formatDuration(phaseTotals[p] ?? 0)}
                  </td>
                ))}
                <td className="py-2 pl-3 text-right font-black text-[#00675c] tabular-nums whitespace-nowrap">
                  {formatDurationHMS(grandTotal)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Export */}
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-3 pt-2">
          <CsvDownloadButton
            headers={csvData.headers}
            rows={csvData.csvRows}
            filename={`tiempo-por-requerimiento-fase_${dateRangeLabel}.csv`}
            label="Exportar CSV"
          />
        </div>
      )}
    </div>
  )
}
