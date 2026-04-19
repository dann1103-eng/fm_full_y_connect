'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { BillingCycle, ClientWithPlan, ContentType, PlanLimits } from '@/types/db'
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, effectiveLimits, limitsToRecord } from '@/lib/domain/plans'
import { nextCycleDates } from '@/lib/domain/cycles'
import { computeTotals } from '@/lib/domain/requirement'
import { migrateOpenPipelineItems } from '@/lib/domain/pipeline'

const avatarGradients = [
  'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)',
  'linear-gradient(135deg, #4a6319 0%, #ceee93 100%)',
  'linear-gradient(135deg, #006385 0%, #1dc0fe 100%)',
  'linear-gradient(135deg, #5c4a8a 0%, #b89cff 100%)',
  'linear-gradient(135deg, #7a4f00 0%, #ffcc5c 100%)',
]
function clientGradient(name: string) {
  return avatarGradients[name.charCodeAt(0) % avatarGradients.length]
}
function getInitials(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

type ActionType = 'renovar' | 'cambiar_plan' | 'pausar' | null

interface Plan { id: string; name: string; limits_json: PlanLimits }

interface RenewalRowProps {
  cycle: BillingCycle
  client: ClientWithPlan
  daysLeft: number
  isAdmin: boolean
  allPlans: Plan[]
}

const CONTENT_TO_PLAN_KEY: Record<ContentType, keyof PlanLimits> = {
  historia: 'historias',
  estatico: 'estaticos',
  video_corto: 'videos_cortos',
  reel: 'reels',
  short: 'shorts',
  produccion: 'producciones',
  reunion: 'reuniones',
}

export function RenewalRow({ cycle, client, daysLeft, isAdmin, allPlans }: RenewalRowProps) {
  const router = useRouter()
  const [action, setAction] = useState<ActionType>(null)
  const [loading, setLoading] = useState(false)
  const [selectedPlanId, setSelectedPlanId] = useState(client.current_plan_id)
  const [rolloverChecked, setRolloverChecked] = useState<Partial<Record<ContentType, boolean>>>({})
  const [pauseConfirm, setPauseConfirm] = useState(false)

  const isOverdue = daysLeft < 0
  const limits = effectiveLimits(cycle.limits_snapshot_json, cycle.rollover_from_previous_json)

  async function markPaid() {
    setLoading(true)
    const supabase = createClient()
    await supabase
      .from('billing_cycles')
      .update({ payment_status: 'paid', payment_date: new Date().toISOString().split('T')[0] })
      .eq('id', cycle.id)
    setLoading(false)
    router.refresh()
  }

  async function handleRenew() {
    setLoading(true)
    const supabase = createClient()

    // Fetch current cycle requirements to compute real rollover amounts
    const { data: cons } = await supabase
      .from('requirements')
      .select('*')
      .eq('billing_cycle_id', cycle.id)

    const totals = computeTotals(cons ?? [])

    // Determine which plan to use for the new cycle
    const planId = action === 'cambiar_plan' ? selectedPlanId : client.current_plan_id
    const planLimits = action === 'cambiar_plan'
      ? allPlans.find((p) => p.id === planId)?.limits_json ?? client.plan.limits_json
      : client.plan.limits_json

    // Build rollover: only checked types with unused > 0
    const rolloverJson: Partial<PlanLimits> = {}
    let hasRollover = false
    for (const type of CONTENT_TYPES) {
      if (rolloverChecked[type]) {
        const unused = limits[type] - totals[type]
        if (unused > 0) {
          rolloverJson[CONTENT_TO_PLAN_KEY[type]] = unused
          hasRollover = true
        }
      }
    }

    const { periodStart, periodEnd } = nextCycleDates(cycle.period_end, client.billing_day)

    // Archive current cycle and update client plan if changed
    await Promise.all([
      supabase.from('billing_cycles').update({ status: 'archived' }).eq('id', cycle.id),
      action === 'cambiar_plan'
        ? supabase.from('clients').update({ current_plan_id: planId, status: 'active' }).eq('id', client.id)
        : supabase.from('clients').update({ status: 'active' }).eq('id', client.id),
    ])

    // Create new cycle
    const { data: newCycle } = await supabase
      .from('billing_cycles')
      .insert({
        client_id: client.id,
        plan_id_snapshot: planId,
        limits_snapshot_json: planLimits,
        rollover_from_previous_json: hasRollover ? rolloverJson : null,
        period_start: periodStart,
        period_end: periodEnd,
        status: 'current',
        payment_status: 'unpaid',
      })
      .select('id')
      .single()

    // Trasladar piezas abiertas del pipeline al nuevo ciclo
    if (newCycle?.id) {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (authUser) {
        await migrateOpenPipelineItems(supabase, {
          previousCycleId: cycle.id,
          newCycleId: newCycle.id,
          movedBy: authUser.id,
        })
      }
    }

    setLoading(false)
    router.refresh()
  }

  async function handlePause() {
    setLoading(true)
    const supabase = createClient()
    await Promise.all([
      supabase.from('clients').update({ status: 'paused' }).eq('id', client.id),
      supabase.from('billing_cycles').update({ status: 'archived' }).eq('id', cycle.id),
    ])
    setLoading(false)
    router.refresh()
  }

  function toggleAction(a: ActionType) {
    setAction((prev) => (prev === a ? null : a))
    setPauseConfirm(false)
  }

  const selectedPlan = allPlans.find((p) => p.id === selectedPlanId)

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden transition-all ${
      isOverdue ? 'border-[#b31b25]/40' : 'border-[#abadaf]/20'
    }`}>
      {/* ── Main row ── */}
      <div className="flex items-center gap-4 p-4">
        {/* Avatar */}
        {client.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={client.logo_url} alt={client.name} className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
        ) : (
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
            style={{ background: clientGradient(client.name) }}
          >
            {getInitials(client.name)}
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/clients/${client.id}`} className="font-semibold text-[#2c2f31] hover:text-[#00675c] transition-colors truncate">
              {client.name}
            </Link>
            <span className="text-xs text-[#595c5e] flex-shrink-0">{client.plan.name}</span>
          </div>
          <p className={`text-sm font-medium mt-0.5 ${
            isOverdue ? 'text-[#b31b25]' : daysLeft <= 3 ? 'text-amber-600' : 'text-[#595c5e]'
          }`}>
            {isOverdue
              ? `Vencido hace ${Math.abs(daysLeft)} día${Math.abs(daysLeft) !== 1 ? 's' : ''}`
              : daysLeft === 0 ? 'Vence hoy'
              : `Vence en ${daysLeft} día${daysLeft !== 1 ? 's' : ''}`}
          </p>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            cycle.payment_status === 'paid'
              ? 'bg-[#00675c]/10 text-[#00675c]'
              : 'bg-[#b31b25]/10 text-[#b31b25]'
          }`}>
            {cycle.payment_status === 'paid' ? 'Pagado' : 'Sin pago'}
          </span>

          {cycle.payment_status === 'unpaid' && isAdmin && (
            <button
              onClick={markPaid}
              disabled={loading}
              className="text-xs text-white font-medium px-3 py-1.5 rounded-lg transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
            >
              Marcar pagado
            </button>
          )}

          {isAdmin && (
            <button
              onClick={() => toggleAction(action ? null : 'renovar')}
              className="p-1.5 rounded-lg text-[#747779] hover:bg-[#f5f7f9] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg"
                className={`h-4 w-4 transition-transform ${action ? 'rotate-180' : ''}`}
                viewBox="0 0 24 24" fill="currentColor">
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Expanded panel (admin only) ── */}
      {action && isAdmin && (
        <div className="border-t border-[#abadaf]/10 bg-[#f5f7f9]">

          {/* Action tabs */}
          <div className="flex gap-2 px-4 pt-4">
            <ActionTab label="Renovar" icon="🔄" active={action === 'renovar'} onClick={() => toggleAction('renovar')} color="teal" />
            <ActionTab label="Cambiar plan" icon="📋" active={action === 'cambiar_plan'} onClick={() => toggleAction('cambiar_plan')} color="blue" />
            <ActionTab label="Pausar" icon="⏸" active={action === 'pausar'} onClick={() => toggleAction('pausar')} color="gray" />
          </div>

          {/* ── RENOVAR ── */}
          {(action === 'renovar' || action === 'cambiar_plan') && (
            <div className="px-4 py-4 space-y-4">
              {/* Plan selector (only for cambiar_plan) */}
              {action === 'cambiar_plan' && (
                <div>
                  <p className="text-xs font-semibold text-[#2c2f31] mb-2">Nuevo plan</p>
                  <div className="grid grid-cols-3 gap-2">
                    {allPlans.map((plan) => (
                      <button
                        key={plan.id}
                        onClick={() => setSelectedPlanId(plan.id)}
                        className={`p-3 rounded-xl border-2 text-left transition-all ${
                          selectedPlanId === plan.id
                            ? 'border-[#006385] bg-[#006385]/5'
                            : 'border-[#dfe3e6] bg-white hover:border-[#006385]/40'
                        }`}
                      >
                        <p className={`text-sm font-semibold ${selectedPlanId === plan.id ? 'text-[#006385]' : 'text-[#2c2f31]'}`}>
                          {plan.name}
                        </p>
                        {plan.id === client.current_plan_id && (
                          <p className="text-xs text-[#595c5e] mt-0.5">Plan actual</p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Rollover authorization */}
              <div>
                <p className="text-xs font-semibold text-[#2c2f31] mb-1">
                  Acumulación al siguiente ciclo
                  <span className="font-normal text-[#747779] ml-1">(por defecto: no acumular)</span>
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {CONTENT_TYPES.filter((t) => limits[t] > 0).map((type) => (
                    <label key={type} className="flex items-center gap-2 cursor-pointer bg-white rounded-lg px-3 py-2 border border-[#dfe3e6]">
                      <input
                        type="checkbox"
                        checked={rolloverChecked[type] ?? false}
                        onChange={(e) => setRolloverChecked((prev) => ({ ...prev, [type]: e.target.checked }))}
                        className="rounded accent-[#00675c]"
                      />
                      <span className="text-xs text-[#2c2f31]">{CONTENT_TYPE_LABELS[type]}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Summary */}
              {action === 'cambiar_plan' && selectedPlan && selectedPlan.id !== client.current_plan_id && (
                <div className="bg-[#006385]/5 border border-[#006385]/20 rounded-xl px-3 py-2 text-xs text-[#006385]">
                  El siguiente ciclo iniciará con el plan <strong>{selectedPlan.name}</strong>.
                </div>
              )}

              <button
                onClick={handleRenew}
                disabled={loading}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
              >
                {loading
                  ? 'Procesando...'
                  : action === 'cambiar_plan'
                  ? `Renovar con plan ${selectedPlan?.name ?? ''}`
                  : 'Confirmar renovación'}
              </button>
            </div>
          )}

          {/* ── PAUSAR ── */}
          {action === 'pausar' && (
            <div className="px-4 py-4 space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <p className="text-sm font-semibold text-amber-800 mb-1">Pausar cliente</p>
                <p className="text-xs text-amber-700">
                  El ciclo actual se archivará y no se creará uno nuevo. El cliente quedará en estado <strong>Pausado</strong> hasta que lo reactives manualmente desde su ficha.
                </p>
              </div>

              {!pauseConfirm ? (
                <button
                  onClick={() => setPauseConfirm(true)}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold text-[#595c5e] bg-white border border-[#dfe3e6] hover:border-[#595c5e] transition-all"
                >
                  Sí, pausar este cliente
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-center text-[#595c5e]">¿Confirmas que deseas pausar a <strong>{client.name}</strong>?</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPauseConfirm(false)}
                      className="flex-1 py-2 rounded-xl text-sm text-[#595c5e] bg-white border border-[#dfe3e6]"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handlePause}
                      disabled={loading}
                      className="flex-1 py-2 rounded-xl text-sm font-semibold text-white bg-[#595c5e] hover:bg-[#2c2f31] transition-colors"
                    >
                      {loading ? 'Pausando...' : 'Confirmar pausa'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ActionTab({
  label, icon, active, onClick, color,
}: {
  label: string; icon: string; active: boolean; onClick: () => void; color: 'teal' | 'blue' | 'gray'
}) {
  const activeStyles = {
    teal: 'border-[#00675c] bg-[#00675c]/10 text-[#00675c]',
    blue: 'border-[#006385] bg-[#006385]/10 text-[#006385]',
    gray: 'border-[#595c5e] bg-[#595c5e]/10 text-[#595c5e]',
  }
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 text-xs font-semibold transition-all ${
        active ? activeStyles[color] : 'border-[#dfe3e6] bg-white text-[#595c5e] hover:border-[#abadaf]'
      }`}
    >
      <span>{icon}</span>
      {label}
    </button>
  )
}
