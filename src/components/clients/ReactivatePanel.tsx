'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { ClientWithPlan, Plan, PlanLimits } from '@/types/db'
import { firstCycleDates } from '@/lib/domain/cycles'
import { migrateOpenPipelineItems } from '@/lib/domain/pipeline'

interface ReactivatePanelProps {
  client: ClientWithPlan
  plans: Plan[]
}

export function ReactivatePanel({ client, plans }: ReactivatePanelProps) {
  const router = useRouter()
  const [selectedPlanId, setSelectedPlanId] = useState(client.current_plan_id)
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleReactivate() {
    setLoading(true)
    setError(null)
    const supabase = createClient()

    const plan = plans.find((p) => p.id === selectedPlanId)
    if (!plan) { setError('Plan no encontrado.'); setLoading(false); return }

    // Obtener usuario actual
    const { data: { user: authUser } } = await supabase.auth.getUser()

    // Buscar el último ciclo archivado del cliente (para migración de pipeline)
    const { data: prevCycle } = await supabase
      .from('billing_cycles')
      .select('id')
      .eq('client_id', client.id)
      .eq('status', 'archived')
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { periodStart, periodEnd } = firstCycleDates(startDate, client.billing_day)

    // PRIMERO: crear el nuevo ciclo (si falla, cliente sigue paused — estado seguro)
    const { data: newCycle, error: cycleError } = await supabase
      .from('billing_cycles')
      .insert({
        client_id: client.id,
        plan_id_snapshot: plan.id,
        limits_snapshot_json: plan.limits_json,
        rollover_from_previous_json: null,
        period_start: periodStart,
        period_end: periodEnd,
        status: 'current',
        payment_status: 'unpaid',
      })
      .select('id')
      .single()

    if (cycleError || !newCycle) {
      setError('Error al crear el ciclo.')
      setLoading(false)
      return
    }

    // DESPUÉS: actualizar estado del cliente
    const { error: clientError } = await supabase
      .from('clients')
      .update({ status: 'active', current_plan_id: selectedPlanId })
      .eq('id', client.id)

    if (clientError) {
      setError('Error al reactivar el cliente.')
      setLoading(false)
      return
    }

    // Migrar piezas abiertas del pipeline si había ciclo anterior
    if (prevCycle?.id && authUser) {
      await migrateOpenPipelineItems(supabase, {
        previousCycleId: prevCycle.id,
        newCycleId: newCycle.id,
        movedBy: authUser.id,
      })
    }

    setLoading(false)
    router.refresh()
  }

  return (
    <div className="bg-white rounded-2xl border border-amber-200 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-600" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
          </svg>
        </div>
        <div>
          <h3 className="font-semibold text-[#2c2f31]">Cliente pausado</h3>
          <p className="text-xs text-[#595c5e]">Configura el nuevo ciclo para reactivarlo.</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Plan selector */}
        <div>
          <label className="text-sm font-medium text-[#2c2f31] mb-2 block">Plan para el nuevo ciclo</label>
          <div className="grid grid-cols-3 gap-2">
            {plans.map((plan) => (
              <button
                key={plan.id}
                onClick={() => setSelectedPlanId(plan.id)}
                className={`p-3 rounded-xl border-2 text-left transition-all ${
                  selectedPlanId === plan.id
                    ? 'border-[#00675c] bg-[#00675c]/5'
                    : 'border-[#dfe3e6] bg-[#f5f7f9] hover:border-[#00675c]/40'
                }`}
              >
                <p className={`text-sm font-semibold ${selectedPlanId === plan.id ? 'text-[#00675c]' : 'text-[#2c2f31]'}`}>
                  {plan.name}
                </p>
                <p className="text-xs text-[#595c5e]">${plan.price_usd}/mes</p>
                {plan.id === client.current_plan_id && (
                  <p className="text-xs text-[#4a6319] mt-0.5">Plan actual</p>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Start date */}
        <div className="flex items-end gap-4">
          <div className="flex-1 space-y-1.5">
            <label className="text-sm font-medium text-[#2c2f31] block">Fecha de inicio del ciclo</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full py-2 px-3 text-sm bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl text-[#2c2f31] focus:outline-none focus:border-[#00675c]"
            />
          </div>
          <div className="text-xs text-[#595c5e] pb-2.5">
            Día de facturación: <span className="font-semibold text-[#2c2f31]">{client.billing_day}</span>
          </div>
        </div>

        {error && (
          <p className="text-sm text-[#b31b25] bg-[#b31b25]/5 rounded-xl px-3 py-2 border border-[#b31b25]/20">
            {error}
          </p>
        )}

        <button
          onClick={handleReactivate}
          disabled={loading}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
        >
          {loading ? 'Reactivando...' : 'Reactivar cliente y crear ciclo'}
        </button>
      </div>
    </div>
  )
}
