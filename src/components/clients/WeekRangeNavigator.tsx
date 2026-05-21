'use client'

import { useState } from 'react'
import type { BillingPeriod, WeekKey } from '@/types/db'

/**
 * Navegador de rangos de semanas para planes bimensuales (8 semanas).
 *
 * Para monthly/biweekly (4 semanas) muestra una sola página sin flechas.
 * Para bimonthly (8 semanas) muestra dos páginas:
 *   - Página 1: S1-S4 (corresponde al 1er pago)
 *   - Página 2: S5-S8 (corresponde al 2do pago)
 * Con flechas izquierda/derecha y transición animada `translateX`.
 *
 * El estado de bloqueo por pago lo maneja el caller dentro de `renderWeek`.
 */
interface WeekRangeNavigatorProps {
  billingPeriod: BillingPeriod
  /** Renderiza cada semana — el caller decide si está locked, current, etc. */
  renderWeek: (weekKey: WeekKey, weekIndex: number) => React.ReactNode
  /** Página inicial (0 = S1-S4, 1 = S5-S8). Default: detectar por currentWeekIndex. */
  initialPage?: 0 | 1
  /** Semana actual (1-based). Si está entre 5-8 y billingPeriod=bimonthly, página inicial = 1. */
  currentWeekIndex?: number
  /** Etiqueta de estado de pago por página, opcional. */
  paymentStatusLabel?: { page0?: string; page1?: string }
  className?: string
}

const WEEKS_BIMONTHLY: WeekKey[] = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']
const WEEKS_BASE: WeekKey[] = ['S1', 'S2', 'S3', 'S4']

export function WeekRangeNavigator({
  billingPeriod,
  renderWeek,
  initialPage,
  currentWeekIndex,
  paymentStatusLabel,
  className = '',
}: WeekRangeNavigatorProps) {
  const isBimonthly = billingPeriod === 'bimonthly'
  const defaultPage: 0 | 1 = initialPage ?? (isBimonthly && currentWeekIndex && currentWeekIndex >= 5 ? 1 : 0)
  const [page, setPage] = useState<0 | 1>(defaultPage)

  if (!isBimonthly) {
    return (
      <div className={`grid grid-cols-2 md:grid-cols-4 gap-2 ${className}`}>
        {WEEKS_BASE.map((wk, i) => renderWeek(wk, i + 1))}
      </div>
    )
  }

  const pageLabel = page === 0 ? '1er mes (S1-S4)' : '2do mes (S5-S8)'
  const pagePaymentLabel = page === 0 ? paymentStatusLabel?.page0 : paymentStatusLabel?.page1

  return (
    <div className={`relative ${className}`}>
      {/* Header con etiquetas y controles */}
      <div className="flex items-center justify-between mb-2 px-1">
        <button
          type="button"
          onClick={() => setPage(0)}
          disabled={page === 0}
          className="flex items-center justify-center w-7 h-7 rounded-full bg-fm-surface-container-high text-fm-on-surface hover:bg-fm-primary/10 disabled:opacity-30 transition"
          aria-label="Semanas 1-4"
        >
          <span className="material-symbols-outlined text-base leading-none">chevron_left</span>
        </button>

        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[11px] font-bold text-fm-on-surface uppercase tracking-wider">{pageLabel}</span>
          {pagePaymentLabel && (
            <span className="text-[10px] text-fm-on-surface-variant">{pagePaymentLabel}</span>
          )}
          <div className="flex items-center gap-1 mt-0.5">
            <span className={`w-1.5 h-1.5 rounded-full transition-colors ${page === 0 ? 'bg-fm-primary' : 'bg-fm-outline-variant/40'}`} />
            <span className={`w-1.5 h-1.5 rounded-full transition-colors ${page === 1 ? 'bg-fm-primary' : 'bg-fm-outline-variant/40'}`} />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setPage(1)}
          disabled={page === 1}
          className="flex items-center justify-center w-7 h-7 rounded-full bg-fm-surface-container-high text-fm-on-surface hover:bg-fm-primary/10 disabled:opacity-30 transition"
          aria-label="Semanas 5-8"
        >
          <span className="material-symbols-outlined text-base leading-none">chevron_right</span>
        </button>
      </div>

      {/* Container con animación de slide */}
      <div className="overflow-hidden">
        <div
          className="flex transition-transform duration-300 ease-out"
          style={{ transform: `translateX(${page === 0 ? '0%' : '-100%'})` }}
        >
          {/* Página 0 */}
          <div className="w-full flex-shrink-0">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {WEEKS_BIMONTHLY.slice(0, 4).map((wk, i) => renderWeek(wk as WeekKey, i + 1))}
            </div>
          </div>
          {/* Página 1 */}
          <div className="w-full flex-shrink-0">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {WEEKS_BIMONTHLY.slice(4, 8).map((wk, i) => renderWeek(wk as WeekKey, i + 5))}
            </div>
          </div>
        </div>
      </div>

      {/* Hint cuando estás en página 0 */}
      {page === 0 && (
        <div className="mt-1 text-center">
          <span className="text-[10px] text-fm-outline">
            Desliza → para ver semanas 5-8
          </span>
        </div>
      )}
    </div>
  )
}
