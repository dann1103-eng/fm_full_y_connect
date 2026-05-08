'use client'

import { formatDuration } from '@/lib/domain/time'
import type { TimeSummary } from '@/lib/domain/time'

interface Props {
  summary: TimeSummary
}

/**
 * Tarjetas resumen del rango de tiempo seleccionado (día o mes).
 * 5 métricas: online, productivo, % productividad, standby, efectivo.
 */
export function TimeSummaryCards({ summary }: Props) {
  const { onlineSeconds, productiveSeconds, standbySeconds, effectiveSeconds, productivityPercent } = summary

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <Card
        label="Tiempo online"
        value={formatDuration(onlineSeconds)}
        accent="primary"
      />
      <Card
        label="Tiempo productivo"
        value={formatDuration(productiveSeconds)}
        accent="primary"
      />
      <Card
        label="% Productividad"
        value={productivityPercent === null ? '—' : `${productivityPercent}%`}
        accent="neutral"
      />
      <Card
        label="Standby"
        value={formatDuration(standbySeconds)}
        accent="amber"
      />
      <Card
        label="Tiempo efectivo"
        value={formatDuration(effectiveSeconds)}
        accent="primary"
        emphasis
      />
    </div>
  )
}

function Card({
  label,
  value,
  accent,
  emphasis = false,
}: {
  label: string
  value: string
  accent: 'primary' | 'neutral' | 'amber'
  emphasis?: boolean
}) {
  const valueClass = (() => {
    if (accent === 'amber') return 'text-amber-600 dark:text-amber-400'
    if (accent === 'neutral') return 'text-fm-on-surface-variant'
    return emphasis ? 'text-fm-primary' : 'text-fm-on-surface'
  })()

  const bgClass = accent === 'amber'
    ? 'bg-amber-50/60 dark:bg-amber-500/10 border border-amber-200/60 dark:border-amber-500/20'
    : 'bg-fm-surface-container-lowest border border-fm-surface-container-high'

  return (
    <div className={`rounded-2xl px-4 py-3 ${bgClass}`}>
      <p className="text-[10px] font-extrabold text-fm-outline-variant uppercase tracking-widest mb-1">
        {label}
      </p>
      <p className={`text-2xl font-black tabular-nums ${valueClass}`}>
        {value}
      </p>
    </div>
  )
}
