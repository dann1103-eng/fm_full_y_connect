'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { BillingCycle, BillingPeriod, CambiosPackage, ClientWithPlan, ContentType, ExtraContentItem, PlanLimits } from '@/types/db'
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, EXTRA_CONTENT_PRICES, NON_CARRYOVER_TYPES, effectiveLimits } from '@/lib/domain/plans'
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

type PanelMode = null | 'simple' | 'cambios' | 'pausar'

interface Plan { id: string; name: string; limits_json: PlanLimits; cambios_included: number; unified_content_limit?: number | null }

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
  matriz_contenido: 'matrices_contenido',
}

export function RenewalRow({ cycle, client, daysLeft, isAdmin, allPlans }: RenewalRowProps) {
  const router = useRouter()
  const [expanded, setExpanded] = useState(false)
  const [mode, setMode] = useState<PanelMode>(null)
  const [loading, setLoading] = useState(false)
  const [pauseConfirm, setPauseConfirm] = useState(false)

  // "Hacer cambios" panel state
  const [selectedPlanId, setSelectedPlanId] = useState(client.current_plan_id)
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>(client.billing_period)
  const [rolloverChecked, setRolloverChecked] = useState<Partial<Record<ContentType, boolean>>>({})
  const [cambiosPackages, setCambiosPackages] = useState<CambiosPackage[]>([])
  const [extraContent, setExtraContent] = useState<ExtraContentItem[]>([])
  const [pkgQty, setPkgQty] = useState('5')
  const [pkgPrice, setPkgPrice] = useState('')
  const [pkgNote, setPkgNote] = useState('')
  const [extraType, setExtraType] = useState<ContentType>('video_corto')
  const [extraQty, setExtraQty] = useState('1')
  const [extraNote, setExtraNote] = useState('')
  const [extraLabel, setExtraLabel] = useState('')
  const [extraIsCustom, setExtraIsCustom] = useState(false)
  const [extraPrice, setExtraPrice] = useState('')

  const isOverdue = daysLeft < 0
  const limits = effectiveLimits(cycle.limits_snapshot_json, cycle.rollover_from_previous_json)
  const selectedPlan = allPlans.find((p) => p.id === selectedPlanId)

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

  async function doRenew(withChanges: boolean) {
    setLoading(true)
    const supabase = createClient()

    const { data: cons } = await supabase
      .from('requirements')
      .select('*')
      .eq('billing_cycle_id', cycle.id)

    const totals = computeTotals(cons ?? [])

    const planId = withChanges ? selectedPlanId : client.current_plan_id
    const planData = withChanges
      ? allPlans.find((p) => p.id === planId)
      : null
    const basePlan = planData ?? client.plan
    // Copia el unified_content_limit al snapshot si aplica (plan "Contenido")
    const planLimits: PlanLimits = basePlan.unified_content_limit != null
      ? { ...basePlan.limits_json, unified_content_limit: basePlan.unified_content_limit }
      : basePlan.limits_json
    const planCambios = planData?.cambios_included ?? client.plan.cambios_included

    // Build rollover
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

    const { periodStart, periodEnd } = nextCycleDates(cycle.period_end, client.billing_day, {
      billingPeriod: withChanges ? billingPeriod : client.billing_period,
      billingDay2: client.billing_day_2,
    })

    await Promise.all([
      supabase.from('billing_cycles').update({ status: 'archived' }).eq('id', cycle.id),
      supabase.from('clients').update({
        status: 'active',
        ...(withChanges && planId !== client.current_plan_id ? { current_plan_id: planId } : {}),
        ...(withChanges && billingPeriod !== client.billing_period ? { billing_period: billingPeriod } : {}),
      }).eq('id', client.id),
    ])

    const { data: newCycle } = await supabase
      .from('billing_cycles')
      .insert({
        client_id: client.id,
        plan_id_snapshot: planId,
        limits_snapshot_json: planLimits,
        rollover_from_previous_json: hasRollover ? rolloverJson : null,
        period_start: periodStart,
        period_end: periodEnd,
        status: 'current' as const,
        payment_status: 'unpaid' as const,
        cambios_budget: planCambios + (withChanges ? cambiosPackages.reduce((s, p) => s + p.qty, 0) : 0),
        cambios_packages_json: withChanges ? cambiosPackages : [],
        extra_content_json: withChanges ? extraContent : [],
      })
      .select('id')
      .single()

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

  function toggleExpanded() {
    setExpanded((v) => !v)
    setMode(null)
    setPauseConfirm(false)
  }

  function selectMode(m: PanelMode) {
    setMode((prev) => (prev === m ? null : m))
    setPauseConfirm(false)
  }

  function addCambiosPackage() {
    const qty = parseInt(pkgQty) || 0
    if (!qty) return
    setCambiosPackages((prev) => [...prev, {
      qty,
      price_usd: parseFloat(pkgPrice) || null,
      note: pkgNote.trim() || null,
      created_at: new Date().toISOString(),
    }])
    setPkgQty('5'); setPkgPrice(''); setPkgNote('')
  }

  function addExtraItem() {
    const qty = parseInt(extraQty) || 1
    if (extraIsCustom) {
      const label = extraLabel.trim()
      const price = parseFloat(extraPrice) || 0
      if (!label || !price) return
      setExtraContent((prev) => [...prev, {
        label,
        qty,
        price_per_unit: price,
        note: extraNote.trim() || null,
        created_at: new Date().toISOString(),
      }])
      setExtraLabel(''); setExtraPrice(''); setExtraNote('')
    } else {
      const price = EXTRA_CONTENT_PRICES[extraType] ?? 0
      setExtraContent((prev) => [...prev, {
        content_type: extraType,
        label: CONTENT_TYPE_LABELS[extraType],
        qty,
        price_per_unit: price,
        note: extraNote.trim() || null,
        created_at: new Date().toISOString(),
      }])
      setExtraQty('1'); setExtraNote('')
    }
  }

  const totalExtraRevenue = extraContent.reduce((s, e) => s + e.price_per_unit * e.qty, 0)
  const totalCambiosBudget = (selectedPlan?.cambios_included ?? client.plan.cambios_included)
    + cambiosPackages.reduce((s, p) => s + p.qty, 0)

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden transition-all ${
      isOverdue ? 'border-[#b31b25]/40' : 'border-[#abadaf]/20'
    }`}>
      {/* ── Main row ── */}
      <div className="flex items-center gap-4 p-4">
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
              onClick={toggleExpanded}
              className="p-1.5 rounded-lg text-[#747779] hover:bg-[#f5f7f9] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg"
                className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
                viewBox="0 0 24 24" fill="currentColor">
                <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Expanded panel ── */}
      {expanded && isAdmin && (
        <div className="border-t border-[#abadaf]/10 bg-[#f5f7f9]">

          {/* Primary action buttons */}
          <div className="flex gap-2 p-4 pb-0">
            <button
              onClick={() => selectMode('simple')}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all flex-1 justify-center ${
                mode === 'simple'
                  ? 'text-white'
                  : 'bg-white border-2 border-[#00675c] text-[#00675c] hover:bg-[#00675c]/5'
              }`}
              style={mode === 'simple' ? { background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' } : {}}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
              </svg>
              Renovar plan
            </button>

            <button
              onClick={() => selectMode('cambios')}
              className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all flex-1 justify-center ${
                mode === 'cambios'
                  ? 'border-2 border-[#006385] bg-[#006385]/10 text-[#006385]'
                  : 'bg-white border-2 border-[#dfe3e6] text-[#595c5e] hover:border-[#006385]/40'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
              </svg>
              Hacer cambios a renovación
            </button>
          </div>

          {/* ── SIMPLE RENEWAL ── */}
          {mode === 'simple' && (
            <div className="px-4 py-4 space-y-4">
              <div>
                <p className="text-xs font-semibold text-[#2c2f31] mb-1">
                  Acumulación al siguiente ciclo
                  <span className="font-normal text-[#747779] ml-1">(por defecto: no acumular)</span>
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {CONTENT_TYPES.filter((t) => limits[t] > 0 && !NON_CARRYOVER_TYPES.includes(t)).map((type) => (
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

              <button
                onClick={() => doRenew(false)}
                disabled={loading}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
              >
                {loading ? 'Procesando...' : 'Confirmar renovación'}
              </button>
            </div>
          )}

          {/* ── CAMBIOS A RENOVACIÓN ── */}
          {mode === 'cambios' && (
            <div className="px-4 py-4 space-y-5">

              {/* Período de facturación */}
              <div>
                <p className="text-[11px] font-bold text-[#abadaf] uppercase tracking-wider mb-2">
                  Período de facturación
                </p>
                <div className="flex gap-2">
                  {(['monthly', 'biweekly'] as BillingPeriod[]).map((period) => (
                    <button
                      key={period}
                      onClick={() => setBillingPeriod(period)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
                        billingPeriod === period
                          ? 'border-[#006385] bg-[#006385]/10 text-[#006385]'
                          : 'border-[#dfe3e6] bg-white text-[#595c5e] hover:border-[#abadaf]'
                      }`}
                    >
                      {period === 'monthly' ? 'Mensual' : 'Quincenal'}
                    </button>
                  ))}
                </div>
                {billingPeriod !== client.billing_period && (
                  <p className="text-[10px] text-[#006385] mt-1.5">
                    Cambia de <strong>{client.billing_period === 'monthly' ? 'mensual' : 'quincenal'}</strong> a <strong>{billingPeriod === 'monthly' ? 'mensual' : 'quincenal'}</strong>.
                  </p>
                )}
                {billingPeriod === 'biweekly' && (
                  <div className="mt-2 flex items-center gap-2">
                    <label className="text-[11px] font-semibold text-[#2c2f31] flex-shrink-0">2° día de facturación:</label>
                    <input
                      type="number" min={1} max={31}
                      placeholder={client.billing_day_2?.toString() ?? 'ej. 15'}
                      defaultValue={client.billing_day_2 ?? ''}
                      className="w-20 h-8 px-2 rounded-lg border border-[#dfe3e6] bg-white text-xs focus:outline-none focus:border-[#006385]"
                    />
                  </div>
                )}
              </div>

              <div className="h-px bg-[#dfe3e6]" />

              {/* Plan selector */}
              <div>
                <p className="text-[11px] font-bold text-[#abadaf] uppercase tracking-wider mb-2">
                  Plan del siguiente ciclo
                </p>
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

              <div className="h-px bg-[#dfe3e6]" />

              {/* Cambios del ciclo */}
              <div>
                <p className="text-[11px] font-bold text-[#abadaf] uppercase tracking-wider mb-2">
                  Cambios del ciclo
                </p>

                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-white rounded-xl p-2.5 border border-[#dfe3e6]">
                    <p className="text-[10px] text-[#595c5e] mb-0.5">Incluidos en plan</p>
                    <p className="text-lg font-bold text-[#2c2f31]">
                      {selectedPlan?.cambios_included ?? client.plan.cambios_included}
                    </p>
                  </div>
                  <div className="bg-white rounded-xl p-2.5 border border-[#dfe3e6]">
                    <p className="text-[10px] text-[#595c5e] mb-0.5">Paquetes extra</p>
                    <p className="text-lg font-bold text-[#00675c]">
                      +{cambiosPackages.reduce((s, p) => s + p.qty, 0)}
                    </p>
                  </div>
                  <div className="rounded-xl p-2.5 border border-[#00675c]/20" style={{ background: 'rgba(0,103,92,.06)' }}>
                    <p className="text-[10px] text-[#595c5e] mb-0.5">Total</p>
                    <p className="text-lg font-bold text-[#00675c]">{totalCambiosBudget}</p>
                  </div>
                </div>

                <div className="flex gap-2 mb-2">
                  <div className="flex flex-col gap-1 flex-shrink-0 w-16">
                    <label className="text-[10px] font-medium text-[#595c5e]">Cant.</label>
                    <input type="number" min={1} value={pkgQty} onChange={(e) => setPkgQty(e.target.value)}
                      className="h-8 px-2 rounded-lg border border-[#dfe3e6] bg-white text-xs focus:outline-none focus:border-[#00675c]" />
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0 w-24">
                    <label className="text-[10px] font-medium text-[#595c5e]">Precio (USD)</label>
                    <input type="number" step="0.01" placeholder="0.00" value={pkgPrice} onChange={(e) => setPkgPrice(e.target.value)}
                      className="h-8 px-2 rounded-lg border border-[#dfe3e6] bg-white text-xs focus:outline-none focus:border-[#00675c]" />
                  </div>
                  <div className="flex flex-col gap-1 flex-1">
                    <label className="text-[10px] font-medium text-[#595c5e]">Nota</label>
                    <input placeholder="opcional" value={pkgNote} onChange={(e) => setPkgNote(e.target.value)}
                      className="h-8 px-2 rounded-lg border border-[#dfe3e6] bg-white text-xs focus:outline-none focus:border-[#00675c]" />
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <label className="text-[10px] text-transparent">add</label>
                    <button onClick={addCambiosPackage}
                      className="h-8 px-3 rounded-lg border border-[#00675c] text-[#00675c] text-xs font-semibold hover:bg-[#00675c]/5">
                      + Agregar
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  {cambiosPackages.map((pkg, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs px-3 py-2 bg-white rounded-lg border border-[#dfe3e6]">
                      <span className="flex-1 text-[#2c2f31]">
                        <strong>+{pkg.qty} cambios</strong>
                        {pkg.price_usd != null && ` · $${pkg.price_usd.toFixed(2)}`}
                        {pkg.note && ` · ${pkg.note}`}
                      </span>
                      <button onClick={() => setCambiosPackages((prev) => prev.filter((_, j) => j !== i))}
                        className="text-[#b31b25] opacity-60 hover:opacity-100">
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
                      </button>
                    </div>
                  ))}
                  {cambiosPackages.length === 0 && (
                    <p className="text-xs text-[#abadaf] italic px-1">Sin paquetes extra.</p>
                  )}
                </div>
              </div>

              <div className="h-px bg-[#dfe3e6]" />

              {/* Contenido extra / servicios */}
              <div>
                <p className="text-[11px] font-bold text-[#abadaf] uppercase tracking-wider mb-0.5">
                  Contenido extra vendido
                </p>
                <p className="text-[10px] text-[#747779] mb-3">
                  Cobros adicionales fuera del plan — fotografía, diseño, consultorías, etc.
                </p>

                {/* Mode toggle */}
                <div className="flex gap-1 mb-3 bg-white rounded-lg border border-[#dfe3e6] p-0.5 w-fit">
                  <button
                    onClick={() => setExtraIsCustom(false)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                      !extraIsCustom ? 'bg-[#f5f7f9] text-[#2c2f31] shadow-sm' : 'text-[#747779]'
                    }`}
                  >
                    Estándar
                  </button>
                  <button
                    onClick={() => setExtraIsCustom(true)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                      extraIsCustom ? 'bg-[#f5f7f9] text-[#2c2f31] shadow-sm' : 'text-[#747779]'
                    }`}
                  >
                    Personalizado
                  </button>
                </div>

                {!extraIsCustom && (
                  <div className="flex gap-1.5 mb-2 flex-wrap">
                    {(Object.entries(EXTRA_CONTENT_PRICES) as [ContentType, number][]).map(([type, price]) => (
                      <span key={type} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#f5f7f9] border border-[#dfe3e6] text-[#595c5e]">
                        {CONTENT_TYPE_LABELS[type]} · ${price}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 mb-2">
                  {extraIsCustom ? (
                    <>
                      <div className="flex flex-col gap-1 flex-1">
                        <label className="text-[10px] font-medium text-[#595c5e]">Descripción</label>
                        <input placeholder="ej. Sesión fotográfica" value={extraLabel} onChange={(e) => setExtraLabel(e.target.value)}
                          className="h-8 px-2 rounded-lg border border-[#dfe3e6] bg-white text-xs focus:outline-none focus:border-[#00675c]" />
                      </div>
                      <div className="flex flex-col gap-1 flex-shrink-0 w-20">
                        <label className="text-[10px] font-medium text-[#595c5e]">Precio/u</label>
                        <input type="number" step="0.01" placeholder="0.00" value={extraPrice} onChange={(e) => setExtraPrice(e.target.value)}
                          className="h-8 px-2 rounded-lg border border-[#dfe3e6] bg-white text-xs focus:outline-none focus:border-[#00675c]" />
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col gap-1 flex-1">
                      <label className="text-[10px] font-medium text-[#595c5e]">Tipo</label>
                      <select value={extraType} onChange={(e) => setExtraType(e.target.value as ContentType)}
                        className="h-8 px-2 rounded-lg border border-[#dfe3e6] bg-white text-xs text-[#2c2f31] focus:outline-none focus:border-[#00675c]">
                        {(Object.keys(EXTRA_CONTENT_PRICES) as ContentType[]).map((t) => (
                          <option key={t} value={t}>{CONTENT_TYPE_LABELS[t]} · ${EXTRA_CONTENT_PRICES[t]}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="flex flex-col gap-1 flex-shrink-0 w-14">
                    <label className="text-[10px] font-medium text-[#595c5e]">Cant.</label>
                    <input type="number" min={1} value={extraQty} onChange={(e) => setExtraQty(e.target.value)}
                      className="h-8 px-2 rounded-lg border border-[#dfe3e6] bg-white text-xs focus:outline-none focus:border-[#00675c]" />
                  </div>
                  <div className="flex flex-col gap-1 flex-1">
                    <label className="text-[10px] font-medium text-[#595c5e]">Nota</label>
                    <input placeholder="opcional" value={extraNote} onChange={(e) => setExtraNote(e.target.value)}
                      className="h-8 px-2 rounded-lg border border-[#dfe3e6] bg-white text-xs focus:outline-none focus:border-[#00675c]" />
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <label className="text-[10px] text-transparent">add</label>
                    <button onClick={addExtraItem}
                      className="h-8 px-3 rounded-lg border border-[#00675c] text-[#00675c] text-xs font-semibold hover:bg-[#00675c]/5">
                      + Agregar
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  {extraContent.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs px-3 py-2 bg-white rounded-lg border border-[#dfe3e6]">
                      <span className="flex-1 text-[#2c2f31]">
                        {item.qty}× {item.label}
                        {item.note && ` · ${item.note}`}
                      </span>
                      <span className="font-semibold text-[#00675c]">${(item.price_per_unit * item.qty).toFixed(2)}</span>
                      <button onClick={() => setExtraContent((prev) => prev.filter((_, j) => j !== i))}
                        className="text-[#b31b25] opacity-60 hover:opacity-100">
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
                      </button>
                    </div>
                  ))}
                  {extraContent.length === 0 && (
                    <p className="text-xs text-[#abadaf] italic px-1">Sin contenido extra.</p>
                  )}
                </div>

                {extraContent.length > 0 && (
                  <p className="text-xs text-[#595c5e] mt-1.5 px-1">
                    Total: <strong className="text-[#00675c]">${totalExtraRevenue.toFixed(2)}</strong>
                  </p>
                )}
              </div>

              <div className="h-px bg-[#dfe3e6]" />

              {/* Rollover */}
              <div>
                <p className="text-xs font-semibold text-[#2c2f31] mb-1">
                  Acumulación al siguiente ciclo
                  <span className="font-normal text-[#747779] ml-1">(por defecto: no acumular)</span>
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {CONTENT_TYPES.filter((t) => limits[t] > 0 && !NON_CARRYOVER_TYPES.includes(t)).map((type) => (
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

              {selectedPlan && selectedPlan.id !== client.current_plan_id && (
                <div className="bg-[#006385]/5 border border-[#006385]/20 rounded-xl px-3 py-2 text-xs text-[#006385]">
                  El siguiente ciclo iniciará con el plan <strong>{selectedPlan.name}</strong>.
                </div>
              )}

              <button
                onClick={() => doRenew(true)}
                disabled={loading}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
              >
                {loading ? 'Procesando...' : 'Confirmar renovación con cambios'}
              </button>
            </div>
          )}

          {/* ── PAUSAR ── */}
          <div className="px-4 pb-4 pt-3">
            {mode !== 'simple' && mode !== 'cambios' && (
              <button
                onClick={() => selectMode('pausar')}
                className="text-xs text-[#595c5e] hover:text-[#b31b25] transition-colors underline underline-offset-2"
              >
                Pausar cliente
              </button>
            )}

            {mode === 'pausar' && (
              <div className="space-y-3 mt-1">
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
                        onClick={() => { setPauseConfirm(false); selectMode(null) }}
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

            {(mode === 'simple' || mode === 'cambios') && (
              <button
                onClick={() => selectMode('pausar')}
                className="text-xs text-[#595c5e] hover:text-[#b31b25] transition-colors underline underline-offset-2 mt-1"
              >
                Pausar cliente en su lugar
              </button>
            )}
          </div>

        </div>
      )}
    </div>
  )
}
