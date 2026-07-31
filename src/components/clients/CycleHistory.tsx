'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { BillingCycle, Requirement, RequirementCambioLog } from '@/types/db'
import { RequirementHistory } from './RequirementHistory'

const MONTHS_FULL = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
]

interface CycleHistoryProps {
  cycles: BillingCycle[]
  clientId: string
  plansMap: Record<string, string>
  isAdmin: boolean
  isApprover: boolean
  userMap: Record<string, string>
}

/**
 * Lista de TODOS los ciclos archivados/pending_renewal del cliente. Cada fila
 * es expandible: al hacer clic, carga (y cachea) los requerimientos de ESE
 * ciclo específico y los muestra con RequirementHistory.
 *
 * Antes solo mostraba la lista sin poder entrar a ningún ciclo — el único
 * lugar donde se podían ver requerimientos pasados era el toggle "Anterior"
 * de CycleHistorySwitcher, que solo cubre el ciclo archivado más reciente.
 * Clientes con más de un ciclo archivado (ej. tras un cambio de plan a mitad
 * de ciclo, o una renovación) tenían el resto de su historial inalcanzable
 * desde la UI aunque los datos siguieran intactos en la base.
 */
export function CycleHistory({ cycles, plansMap, isAdmin, isApprover, userMap }: CycleHistoryProps) {
  const [open, setOpen] = useState(false)
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(null)
  const [loadingCycleId, setLoadingCycleId] = useState<string | null>(null)
  const [reqsByCycle, setReqsByCycle] = useState<Record<string, Requirement[]>>({})
  const [cambioLogsByCycle, setCambioLogsByCycle] = useState<Record<string, Record<string, RequirementCambioLog[]>>>({})

  function formatMonthYear(d: string): string {
    const date = new Date(d)
    return `${MONTHS_FULL[date.getMonth()]} ${date.getFullYear()}`
  }

  async function handleToggleCycle(cycleId: string) {
    if (expandedCycleId === cycleId) {
      setExpandedCycleId(null)
      return
    }
    setExpandedCycleId(cycleId)
    if (reqsByCycle[cycleId]) return

    setLoadingCycleId(cycleId)
    const supabase = createClient()
    const { data: reqsRaw } = await supabase
      .from('requirements')
      .select('*')
      .eq('billing_cycle_id', cycleId)
      .eq('approval_status', 'approved')
      .order('registered_at', { ascending: false })
    const reqs = (reqsRaw ?? []) as Requirement[]

    const cambioLogsMap: Record<string, RequirementCambioLog[]> = {}
    if (reqs.length > 0) {
      const { data: logsRaw } = await supabase
        .from('requirement_cambio_logs')
        .select('*')
        .in('requirement_id', reqs.map((r) => r.id))
        .order('created_at', { ascending: false })
      for (const log of logsRaw ?? []) {
        const l = log as RequirementCambioLog
        if (!cambioLogsMap[l.requirement_id]) cambioLogsMap[l.requirement_id] = []
        cambioLogsMap[l.requirement_id].push(l)
      }
    }

    setReqsByCycle((prev) => ({ ...prev, [cycleId]: reqs }))
    setCambioLogsByCycle((prev) => ({ ...prev, [cycleId]: cambioLogsMap }))
    setLoadingCycleId(null)
  }

  return (
    <section>
      <div className="glass-panel rounded-[2rem] overflow-hidden">
        {/* Toggle header */}
        <button type="button"
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
              const isExpanded = expandedCycleId === cycle.id
              const isLoading = loadingCycleId === cycle.id

              return (
                <div key={cycle.id}>
                  <button
                    type="button"
                    onClick={() => handleToggleCycle(cycle.id)}
                    className="w-full flex items-center justify-between p-4 rounded-2xl hover:bg-fm-surface-container transition-colors border border-transparent hover:border-fm-surface-container-high"
                  >
                    {/* Left: icon + month + plan */}
                    <div className="flex items-center gap-4">
                      <span
                        className="material-symbols-outlined text-fm-on-surface-variant transition-transform duration-200"
                        style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      >
                        chevron_right
                      </span>
                      <div className="text-left">
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
                  </button>

                  {isExpanded && (
                    <div className="pl-6 pr-2 pb-2 pt-1">
                      {isLoading ? (
                        <p className="text-sm text-fm-outline-variant py-4 italic">Cargando…</p>
                      ) : (reqsByCycle[cycle.id]?.length ?? 0) === 0 ? (
                        <p className="text-sm text-fm-outline-variant py-4 italic">
                          Este ciclo no tuvo requerimientos registrados.
                        </p>
                      ) : (
                        <RequirementHistory
                          requirements={reqsByCycle[cycle.id] ?? []}
                          isAdmin={isAdmin}
                          isApprover={isApprover}
                          cycleId={cycle.id}
                          userMap={userMap}
                          cambioLogsMap={cambioLogsByCycle[cycle.id] ?? {}}
                        />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
