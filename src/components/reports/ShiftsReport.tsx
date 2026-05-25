'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatDuration, isoDateStr } from '@/lib/domain/time'
import { fetchShiftsReportForDate, type ShiftDayRow } from '@/app/actions/shifts-report'

interface UserMini {
  id: string
  full_name: string
}

export function ShiftsReport({ users }: { users: UserMini[] }) {
  const [dateStr, setDateStr] = useState<string>(() => isoDateStr(new Date()))
  const [rows, setRows] = useState<ShiftDayRow[] | null>(null)
  const [loading, setLoading] = useState(false)

  const userMap = new Map(users.map((u) => [u.id, u.full_name]))

  const load = useCallback(async (d: string) => {
    setLoading(true)
    try {
      const data = await fetchShiftsReportForDate(d)
      setRows(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(dateStr)
  }, [dateStr, load])

  const today = isoDateStr(new Date())

  return (
    <div className="space-y-4">
      {/* Selector de fecha */}
      <div className="flex items-center gap-3">
        <label htmlFor="f-fecha-07800021" className="text-xs font-semibold text-fm-on-surface-variant uppercase tracking-wider">
          Fecha
        </label>
        <input id="f-fecha-07800021"
          type="date"
          value={dateStr}
          max={today}
          onChange={(e) => { if (e.target.value) setDateStr(e.target.value) }}
          className="text-sm border border-fm-outline-variant/40 rounded-lg px-3 py-1.5 bg-fm-surface-container text-fm-on-surface focus:outline-none focus:ring-2 focus:ring-fm-primary/40"
        />
        {dateStr !== today && (
          <button type="button"
            onClick={() => setDateStr(today)}
            className="text-xs text-fm-primary hover:underline"
          >
            Hoy
          </button>
        )}
      </div>

      {loading && (
        <p className="text-sm text-fm-on-surface-variant">Cargando…</p>
      )}

      {!loading && rows !== null && rows.length === 0 && (
        <p className="text-sm text-fm-on-surface-variant">
          No hay jornadas registradas para este día.
        </p>
      )}

      {!loading && rows !== null && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-fm-surface-container-high">
                <th className="text-left py-2 pr-4 font-extrabold text-fm-on-surface-variant uppercase text-xs tracking-wider">
                  Persona
                </th>
                <th className="text-right py-2 px-4 font-extrabold text-fm-on-surface-variant uppercase text-xs tracking-wider">
                  Online
                </th>
                <th className="text-right py-2 px-4 font-extrabold text-fm-on-surface-variant uppercase text-xs tracking-wider">
                  Pausas
                </th>
                <th className="text-right py-2 px-4 font-extrabold text-fm-on-surface-variant uppercase text-xs tracking-wider">
                  Productivo
                </th>
                <th className="text-right py-2 pl-4 font-extrabold text-fm-on-surface-variant uppercase text-xs tracking-wider">
                  % Productivo
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const pct =
                  row.onlineSeconds > 0
                    ? Math.min(100, Math.round((row.productiveSeconds / row.onlineSeconds) * 100))
                    : 0
                const pctColor =
                  pct >= 70 ? '#00675c' : pct >= 40 ? '#f59e0b' : '#b31b25'
                return (
                  <tr
                    key={row.userId}
                    className="border-b border-fm-surface-container-low hover:bg-fm-background transition-colors"
                  >
                    <td className="py-2.5 pr-4 text-fm-on-surface">
                      {userMap.get(row.userId) ?? '—'}
                      {row.isActive && (
                        <span className="ml-2 text-[10px] font-bold text-fm-primary uppercase">
                          activa
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-fm-on-surface">
                      {formatDuration(row.onlineSeconds)}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-fm-on-surface-variant">
                      {formatDuration(row.breakSeconds)}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-fm-on-surface">
                      {formatDuration(row.productiveSeconds)}
                    </td>
                    <td
                      className="py-2.5 pl-4 text-right font-bold tabular-nums"
                      style={{ color: pctColor }}
                    >
                      {pct}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
