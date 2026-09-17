'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import type { Client, MatrixStatus } from '@/types/db'
import { ClientSearchSelect } from '@/components/ui/ClientSearchSelect'
import type { MatrixListRow } from '@/lib/data/matrices'
import { MATRIX_STATUS_LABELS } from '@/lib/domain/matrix'
import { APP_TZ } from '@/lib/domain/dates'
import { formatDeadlineDate } from '@/lib/domain/deadline'

const STATUS_CLASS: Record<MatrixStatus, string> = {
  draft: 'bg-fm-surface-container-high text-fm-on-surface-variant',
  approved: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-200',
  closed: 'bg-gray-200 text-gray-600 dark:bg-gray-500/20 dark:text-gray-300',
}

const STATUSES = Object.keys(MATRIX_STATUS_LABELS) as MatrixStatus[]

const MONTHS_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export function StatusBadge({ status }: { status: MatrixStatus }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${STATUS_CLASS[status]}`}>{MATRIX_STATUS_LABELS[status]}</span>
}

function monthKey(d: string) { return d.slice(0, 7) }

/** "2026-10" → "octubre 2026" (sin Intl: igual en servidor y navegador). */
function monthLabel(key: string) {
  const [year, month] = key.split('-')
  return `${MONTHS_ES[Number(month) - 1] ?? month} ${year}`
}

/** Timestamp → "16 sep" en la zona de la operación (determinista entre servidor y navegador). */
function shortLocalDate(iso: string) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ }).format(new Date(iso))
  return formatDeadlineDate(day)
}

interface Props {
  rows: MatrixListRow[]
  /** Clientes completos (ordenados por nombre); el filtro ofrece solo los que aparecen en `rows`. */
  clients: Client[]
}

export function MatricesTable({ rows, clients }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<'' | MatrixStatus>('')
  const [clientId, setClientId] = useState('')
  const [month, setMonth] = useState('')

  const filterClients = useMemo(() => {
    const ids = new Set(rows.map((r) => r.client.id))
    return clients.filter((c) => ids.has(c.id))
  }, [rows, clients])
  const months = useMemo(() => [...new Set(rows.map((r) => monthKey(r.period_start)))].sort().reverse(), [rows])

  const filtered = useMemo(() => rows.filter((r) =>
    (!status || r.status === status) && (!clientId || r.client.id === clientId) && (!month || monthKey(r.period_start) === month),
  ), [rows, status, clientId, month])

  // py-2: misma altura que el botón de ClientSearchSelect.
  const selectCls = 'rounded-xl border border-fm-surface-container-high bg-fm-background px-3 py-2 text-sm text-fm-on-surface max-w-full'

  return (
    <section className="glass-panel rounded-2xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={status} onChange={(e) => setStatus(e.target.value as '' | MatrixStatus)} className={selectCls} aria-label="Filtrar por estado">
          <option value="">Todos los estados</option>
          {STATUSES.map((s) => <option key={s} value={s}>{MATRIX_STATUS_LABELS[s]}</option>)}
        </select>
        <div className="flex items-center gap-1 w-full sm:w-64">
          <div className="flex-1 min-w-0">
            <ClientSearchSelect clients={filterClients} value={clientId} onChange={setClientId} placeholder="Todos los clientes" />
          </div>
          {clientId && (
            <button type="button" onClick={() => setClientId('')} aria-label="Quitar filtro de cliente" title="Quitar filtro de cliente"
              className="material-symbols-outlined text-[18px] p-1.5 rounded-lg text-fm-on-surface-variant hover:bg-fm-surface-container-low hover:text-fm-on-surface flex-shrink-0">
              close
            </button>
          )}
        </div>
        <select value={month} onChange={(e) => setMonth(e.target.value)} className={selectCls} aria-label="Filtrar por mes de inicio">
          <option value="">Todos los meses</option>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <span className="ml-auto text-xs text-fm-on-surface-variant">{filtered.length} matri{filtered.length !== 1 ? 'ces' : 'z'}</span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-fm-on-surface-variant py-8 text-center">
          {rows.length === 0 ? 'Todavía no hay matrices.' : 'No hay matrices con esos filtros.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-fm-on-surface-variant border-b border-fm-surface-container-high">
                <th className="py-2 pr-3">Cliente</th>
                <th className="py-2 pr-3">Período</th>
                <th className="py-2 pr-3">Estado</th>
                <th className="py-2 pr-3">Piezas</th>
                <th className="py-2 pr-3 hidden md:table-cell">Última edición</th>
                <th className="py-2 pr-3 hidden md:table-cell">Aprobada por</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} onClick={() => router.push(`/matrices/${r.id}`)}
                  className="border-b border-fm-surface-container-high/60 hover:bg-fm-surface-container-low cursor-pointer">
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {r.client.logo_url
                        ? <Image src={r.client.logo_url} alt="" width={24} height={24} unoptimized className="h-6 w-6 flex-shrink-0 rounded-full object-cover" />
                        : <span className="h-6 w-6 flex-shrink-0 rounded-full bg-fm-primary/15 text-fm-primary text-[10px] font-bold flex items-center justify-center">{r.client.name.slice(0, 1).toUpperCase()}</span>}
                      <div className="min-w-0">
                        <p className="font-medium text-fm-on-surface truncate">{r.client.name}</p>
                        <p className="text-[11px] text-fm-on-surface-variant truncate">{r.title}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 whitespace-nowrap text-fm-on-surface">{r.label}</td>
                  <td className="py-2.5 pr-3"><StatusBadge status={r.status} /></td>
                  <td className="py-2.5 pr-3 tabular-nums text-fm-on-surface whitespace-nowrap">{r.item_count} / {r.capacity}</td>
                  <td className="py-2.5 pr-3 hidden md:table-cell text-fm-on-surface-variant whitespace-nowrap">{shortLocalDate(r.updated_at)}</td>
                  <td className="py-2.5 pr-3 hidden md:table-cell text-fm-on-surface-variant">{r.approved_by_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
