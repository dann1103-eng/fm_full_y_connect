'use client'

import { useState } from 'react'
import type { BillingCycle } from '@/types/db'

const MONTHS_FULL = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]

interface CycleHistoryProps {
  cycles: BillingCycle[]
  clientId: string
  supabase: null
  plansMap: Record<string, string>
}

export function CycleHistory({ cycles, plansMap }: CycleHistoryProps) {
  const [open, setOpen] = useState(false)

  function formatMonthYear(d: string): string {
    const date = new Date(d)
    return `${MONTHS_FULL[date.getMonth()]} ${date.getFullYear()}`
  }

  return (
    <section>
      <div className="glass-panel rounded-[2rem] overflow-hidden">
        {/* Toggle header */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between px-8 py-5 hover:bg-fm-surface-container-lowest/50 transition-colors"
        >
          <span className="text-lg font-extrabold tracking-tight text-fm-on-surface">
            Historial de ciclos anteriores
          </span>
          <span
            className="material-symbols-outlined text-fm-on-surface-variant transition-transform duration-200"
            style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            expand_more
          </span>
        </button>

        {/* Cycle list */}
        {open && (
          <div className="px-8 pb-6 space-y-2">
            {cycles.map((cycle) => {
              const planName = plansMap[cycle.plan_id_snapshot] ?? 'Plan'
              const isPaid = cycle.payment_status === 'paid'

              return (
                <div
                  key={cycle.id}
                  className="flex items-center justify-between p-4 rounded-2xl hover:bg-fm-surface-container transition-colors cursor-pointer border border-transparent hover:border-fm-surface-container-high"
                >
                  {/* Left: icon + month + plan */}
                  <div className="flex items-center gap-4">
                    <span className="material-symbols-outlined text-fm-on-surface-variant">history</span>
                    <div>
                      <p className="font-bold text-sm text-fm-on-surface">
                        {formatMonthYear(cycle.period_start)}
                      </p>
                      <p className="text-xs text-fm-on-surface-variant">
                        {planName}
                        {cycle.status === 'pending_renewal' && (
                          <span className="ml-2 text-fm-error font-semibold">
                            · Pago pendiente
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Right: paid badge + check */}
                  <div className="flex items-center gap-3">
                    {isPaid ? (
                      <>
                        <span className="px-2.5 py-1 bg-fm-secondary-fixed text-fm-on-secondary-container text-[10px] font-extrabold rounded-full uppercase">
                          Pagado
                        </span>
                        <span
                          className="material-symbols-outlined text-fm-secondary text-xl"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          check_circle
                        </span>
                      </>
                    ) : (
                      <span className="px-2.5 py-1 bg-fm-error/10 text-fm-error text-[10px] font-extrabold rounded-full uppercase">
                        Sin pago
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
