'use client'

import type { LeadRow } from '@/app/(app)/leads/page'
import { useMemo } from 'react'

interface Props {
  leads: LeadRow[]
}

export function LeadsStats({ leads }: Props) {
  const stats = useMemo(() => {
    const now = Date.now()
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000

    const active = leads.filter((l) => l.status === 'active').length
    const escalated = leads.filter((l) => l.status === 'escalated').length
    const converted = leads.filter((l) => l.status === 'converted').length
    const rejected = leads.filter((l) => l.status === 'rejected').length

    const monthLeads = leads.filter((l) => new Date(l.created_at).getTime() >= monthAgo)
    const monthConverted = monthLeads.filter((l) => l.status === 'converted').length
    const monthTotal = monthLeads.length
    const conversionRate = monthTotal > 0 ? (monthConverted / monthTotal) * 100 : 0

    const weekNew = leads.filter((l) => new Date(l.created_at).getTime() >= weekAgo).length

    return {
      active,
      escalated,
      converted,
      rejected,
      total: leads.length,
      monthTotal,
      monthConverted,
      conversionRate,
      weekNew,
    }
  }, [leads])

  const cards = [
    { label: 'Activos', value: stats.active, color: 'text-fm-primary', sub: 'En conversación con bot' },
    { label: 'Escalados', value: stats.escalated, color: 'text-amber-600', sub: 'Esperando equipo' },
    { label: 'Convertidos', value: stats.converted, color: 'text-green-600', sub: 'Ahora clientes' },
    { label: 'Nuevos esta semana', value: stats.weekNew, color: 'text-fm-on-surface', sub: 'Últimos 7 días' },
    {
      label: 'Conversión 30d',
      value: `${stats.conversionRate.toFixed(0)}%`,
      color: 'text-green-700',
      sub: `${stats.monthConverted} de ${stats.monthTotal}`,
    },
  ]

  return (
    <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className="rounded-xl border border-fm-outline-variant/30 bg-fm-surface p-4"
        >
          <div className="text-xs text-fm-on-surface-variant uppercase tracking-wide">{c.label}</div>
          <div className={`text-2xl font-semibold mt-1 ${c.color}`}>{c.value}</div>
          <div className="text-xs text-fm-on-surface-variant mt-1">{c.sub}</div>
        </div>
      ))}
    </section>
  )
}
