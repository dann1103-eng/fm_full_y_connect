'use client'

import { useState, useTransition } from 'react'
import { updateDevRequestStatus } from '@/app/actions/devRequests'
import type { DevRequest, DevRequestStatus } from '@/types/db'
import { DEV_REQUEST_STATUS_LABELS } from '@/types/db'

const STATUS_STYLES: Record<DevRequestStatus, string> = {
  pending:     'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  in_progress: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  done:        'bg-fm-primary/10 text-fm-primary border-fm-primary/20',
  rejected:    'bg-fm-error/10 text-fm-error border-fm-error/20',
}

const NEXT_STATUSES: Record<DevRequestStatus, DevRequestStatus[]> = {
  pending:     ['in_progress', 'done', 'rejected'],
  in_progress: ['done', 'rejected', 'pending'],
  done:        ['pending'],
  rejected:    ['pending'],
}

function StatusChip({ status }: { status: DevRequestStatus }) {
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATUS_STYLES[status]}`}>
      {DEV_REQUEST_STATUS_LABELS[status]}
    </span>
  )
}

function RequestCard({ request }: { request: DevRequest }) {
  const [status, setStatus] = useState<DevRequestStatus>(request.status as DevRequestStatus)
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function changeStatus(next: DevRequestStatus) {
    setOpen(false)
    startTransition(async () => {
      const res = await updateDevRequestStatus(request.id, next)
      if ('ok' in res) setStatus(next)
    })
  }

  const date = new Date(request.created_at).toLocaleDateString('es-SV', {
    day: 'numeric', month: 'short', year: 'numeric',
  })

  return (
    <div className={`bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-4 space-y-3 transition-opacity ${isPending ? 'opacity-60' : ''}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-fm-on-surface leading-snug">{request.title}</p>
          <p className="text-xs text-fm-on-surface-variant mt-0.5">{date}</p>
        </div>
        <div className="relative shrink-0">
          <button
            onClick={() => setOpen(v => !v)}
            className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
            disabled={isPending}
          >
            <StatusChip status={status} />
            <span className="text-fm-outline-variant text-xs">▾</span>
          </button>
          {open && (
            <div className="absolute right-0 top-full mt-1 z-10 bg-fm-surface-container-lowest border border-fm-outline-variant/30 rounded-xl shadow-lg overflow-hidden min-w-[140px]">
              {NEXT_STATUSES[status].map(s => (
                <button
                  key={s}
                  onClick={() => changeStatus(s)}
                  className="w-full text-left px-3 py-2 text-xs font-medium text-fm-on-surface hover:bg-fm-background flex items-center gap-2"
                >
                  <StatusChip status={s} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Descripción */}
      <p className="text-sm text-fm-on-surface-variant leading-relaxed">{request.description}</p>

      {/* Retribución prometida — el chiste */}
      <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl px-3 py-2">
        <span className="text-base">💰</span>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">Retribución prometida</p>
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{request.compensation_method}</p>
        </div>
      </div>
    </div>
  )
}

interface Props {
  requests: DevRequest[]
}

export function DevRequestAdminPanel({ requests }: Props) {
  const pending    = requests.filter(r => r.status === 'pending')
  const inProgress = requests.filter(r => r.status === 'in_progress')
  const done       = requests.filter(r => r.status === 'done')
  const rejected   = requests.filter(r => r.status === 'rejected')

  if (requests.length === 0) {
    return (
      <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-12 text-center">
        <p className="text-3xl mb-2">🎉</p>
        <p className="text-sm font-medium text-fm-on-surface">Ninguna solicitud todavía.</p>
        <p className="text-xs text-fm-on-surface-variant mt-1">Cuando alguien te pida algo, aparecerá aquí.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Resumen */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Pendientes" count={pending.length} color="amber" />
        <SummaryCard label="En progreso" count={inProgress.length} color="blue" />
        <SummaryCard label="Completadas" count={done.length} color="teal" />
        <SummaryCard label="Rechazadas" count={rejected.length} color="red" />
      </div>

      {/* Lista */}
      {[
        { label: '🔴 Pendientes', items: pending },
        { label: '🔵 En progreso', items: inProgress },
        { label: '✅ Completadas', items: done },
        { label: '❌ Rechazadas', items: rejected },
      ].map(group => group.items.length > 0 && (
        <div key={group.label}>
          <p className="text-xs font-semibold uppercase tracking-wider text-fm-on-surface-variant mb-3">
            {group.label}
          </p>
          <div className="space-y-3">
            {group.items.map(r => <RequestCard key={r.id} request={r} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

function SummaryCard({
  label,
  count,
  color,
}: {
  label: string
  count: number
  color: 'amber' | 'blue' | 'teal' | 'red'
}) {
  const styles = {
    amber: 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400',
    blue:  'bg-blue-500/10 border-blue-500/20 text-blue-700 dark:text-blue-400',
    teal:  'bg-fm-primary/10 border-fm-primary/20 text-fm-primary',
    red:   'bg-fm-error/10 border-fm-error/20 text-fm-error',
  }
  return (
    <div className={`rounded-2xl border p-4 ${styles[color]}`}>
      <p className="text-2xl font-bold">{count}</p>
      <p className="text-xs font-semibold uppercase tracking-wide mt-1 opacity-80">{label}</p>
    </div>
  )
}
