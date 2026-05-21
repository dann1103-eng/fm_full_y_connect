'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Plan, PlanLimits, WeeklyDistribution, ContentType, WeekKey, BillingPeriod } from '@/types/db'
import { weeksForBillingPeriod } from '@/types/db'
import { createPlan, updatePlan, type PlanInput } from '@/app/actions/plans'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'

const WEEKS_4: WeekKey[] = ['S1', 'S2', 'S3', 'S4']
const WEEKS_8: WeekKey[] = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']
const TIPPABLE: ContentType[] = ['historia', 'estatico', 'video_corto', 'reel', 'short']
const TIPPABLE_LIMIT_KEYS = [
  'historias',
  'estaticos',
  'videos_cortos',
  'reels',
  'shorts',
] as const satisfies readonly (keyof PlanLimits)[]

const BILLING_PERIOD_LABELS: Record<BillingPeriod, { label: string; help: string }> = {
  monthly:   { label: 'Mensual',    help: 'Ciclo de ~30 días. 4 semanas. 1 pago al inicio.' },
  biweekly:  { label: 'Quincenal',  help: 'Ciclo de 14 días. 2 semanas por pago. Cliente paga al inicio y a los 15 días.' },
  bimonthly: { label: 'Bimestral',  help: 'Ciclo de 60 días. 8 semanas. 2 pagos manuales (al inicio y a los 30 días). El cron no factura automáticamente.' },
}

interface PlanFormProps {
  plan?: Plan          // undefined = crear; definido = editar
  onClose: () => void
}

function emptyLimits(): PlanLimits {
  return {
    historias: 0,
    estaticos: 0,
    videos_cortos: 0,
    reels: 0,
    shorts: 0,
    producciones: 0,
    reuniones: 0,
    reunion_duracion_horas: 1,
    matrices_contenido: 1,
  }
}

function emptyDistribution(billingPeriod: BillingPeriod): WeeklyDistribution {
  const weeks = weeksForBillingPeriod(billingPeriod)
  const result: WeeklyDistribution = {}
  for (const w of weeks) {
    result[w] = { historia: 0, estatico: 0, video_corto: 0, reel: 0, short: 0 }
  }
  return result
}

export function PlanForm({ plan, onClose }: PlanFormProps) {
  const router = useRouter()
  const isEditing = !!plan
  const [name, setName] = useState(plan?.name ?? '')
  const [priceUsd, setPriceUsd] = useState<string>(plan ? String(plan.price_usd) : '')
  const [cambiosIncluded, setCambiosIncluded] = useState<string>(
    plan ? String(plan.cambios_included) : '1'
  )
  const [active, setActive] = useState(plan?.active ?? true)
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>(plan?.billing_period ?? 'monthly')
  const [limits, setLimits] = useState<PlanLimits>(plan?.limits_json ?? emptyLimits())
  const [distribution, setDistribution] = useState<WeeklyDistribution>(
    plan?.default_weekly_distribution_json ?? emptyDistribution(plan?.billing_period ?? 'monthly')
  )
  const [useDistribution, setUseDistribution] = useState<boolean>(
    !!plan?.default_weekly_distribution_json
  )
  const [useUnifiedPool, setUseUnifiedPool] = useState<boolean>(
    plan?.unified_content_limit != null
  )
  const [unifiedPoolSize, setUnifiedPoolSize] = useState<string>(
    plan?.unified_content_limit != null ? String(plan.unified_content_limit) : '10'
  )
  const [noExpira, setNoExpira] = useState<boolean>(plan?.no_expira ?? false)
  const [saving, setSaving] = useState(false)

  function handleTogglePool(next: boolean) {
    setUseUnifiedPool(next)
    if (next) {
      const cleared: PlanLimits = { ...limits }
      for (const k of TIPPABLE_LIMIT_KEYS) cleared[k] = 0
      setLimits(cleared)
    }
  }

  /** Cambia el billing_period y reajusta la distribución (recorta a 4 o expande a 8 weeks). */
  function handleChangeBillingPeriod(next: BillingPeriod) {
    setBillingPeriod(next)
    const targetWeeks = weeksForBillingPeriod(next)
    const newDist: WeeklyDistribution = {}
    for (const w of targetWeeks) {
      newDist[w] = distribution[w] ?? { historia: 0, estatico: 0, video_corto: 0, reel: 0, short: 0 }
    }
    setDistribution(newDist)
  }
  const [error, setError] = useState<string | null>(null)

  function updateLimit(key: keyof PlanLimits, val: string) {
    const num = parseInt(val, 10)
    setLimits({ ...limits, [key]: isNaN(num) ? 0 : Math.max(0, num) })
  }

  function updateDist(week: WeekKey, type: ContentType, val: string) {
    const num = parseInt(val, 10)
    setDistribution({
      ...distribution,
      [week]: {
        ...(distribution[week] ?? {}),
        [type]: isNaN(num) ? 0 : Math.max(0, num),
      },
    })
  }

  async function handleSubmit() {
    setError(null)
    setSaving(true)

    const poolNum = parseInt(unifiedPoolSize, 10)
    const unified = useUnifiedPool && !isNaN(poolNum) && poolNum > 0 ? poolNum : null

    const payload: PlanInput = {
      name,
      price_usd: parseFloat(priceUsd) || 0,
      cambios_included: parseInt(cambiosIncluded, 10) || 0,
      active,
      billing_period: billingPeriod,
      limits_json: limits,
      default_weekly_distribution_json: useDistribution ? distribution : null,
      unified_content_limit: unified,
      no_expira: noExpira,
    }

    const res = isEditing
      ? await updatePlan(plan!.id, payload)
      : await createPlan(payload)

    setSaving(false)
    if (res.error) {
      setError(res.error)
      return
    }
    router.refresh()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-fm-surface-container-lowest rounded-[2rem] p-8 w-full max-w-2xl space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-fm-on-surface">
            {isEditing ? 'Editar plan' : 'Crear plan'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-fm-background text-fm-on-surface-variant"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Datos generales */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">
              Nombre
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Premium Plus"
              className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">
              Precio (USD)
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={priceUsd}
              onChange={(e) => setPriceUsd(e.target.value)}
              placeholder="200"
              className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">
              Cambios incluidos
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={cambiosIncluded}
              onChange={(e) => setCambiosIncluded(e.target.value)}
              className="mt-1.5 w-full border border-fm-surface-container-high rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="accent-fm-primary"
              />
              <span className="text-sm font-medium text-fm-on-surface">Plan activo</span>
            </label>
          </div>
        </div>

        {/* Pool unificado (plan Contenido) */}
        <div className="bg-fm-background rounded-xl p-4 space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useUnifiedPool}
              onChange={(e) => handleTogglePool(e.target.checked)}
              className="accent-fm-primary"
            />
            <span className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">
              Plan Contenido (pool unificado)
            </span>
          </label>
          {useUnifiedPool && (
            <div className="flex items-center gap-3 pl-6">
              <span className="text-sm text-fm-on-surface">Total de contenidos tippables:</span>
              <input
                type="number"
                min="1"
                value={unifiedPoolSize}
                onChange={(e) => setUnifiedPoolSize(e.target.value)}
                className="w-20 border border-fm-surface-container-high rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
              />
              <span className="text-xs text-fm-outline">
                (estáticos + videos cortos + reels + shorts comparten este pool)
              </span>
            </div>
          )}
        </div>

        {/* Periodicidad del plan */}
        <div className="bg-fm-background rounded-xl p-4 space-y-2">
          <span className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide block">
            Periodicidad
          </span>
          <div className="flex flex-col gap-2 pl-1">
            {(Object.keys(BILLING_PERIOD_LABELS) as BillingPeriod[]).map((bp) => (
              <label key={bp} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="billing_period"
                  checked={billingPeriod === bp}
                  onChange={() => handleChangeBillingPeriod(bp)}
                  className="accent-fm-primary mt-1"
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-fm-on-surface">{BILLING_PERIOD_LABELS[bp].label}</span>
                  <span className="text-xs text-fm-outline">{BILLING_PERIOD_LABELS[bp].help}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Vencimiento del plan */}
        <div className="bg-fm-background rounded-xl p-4 space-y-2">
          <span className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide block">
            Vencimiento
          </span>
          <div className="flex flex-col gap-2 pl-1">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="expiration"
                checked={!noExpira}
                onChange={() => setNoExpira(false)}
                className="accent-fm-primary mt-1"
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium text-fm-on-surface">Mensual</span>
                <span className="text-xs text-fm-outline">
                  Los ciclos se archivan al cierre del período y requieren renovación / pago.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="expiration"
                checked={noExpira}
                onChange={() => setNoExpira(true)}
                className="accent-fm-primary mt-1"
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium text-fm-on-surface">No vence</span>
                <span className="text-xs text-fm-outline">
                  Los ciclos con este plan no se archivan automáticamente; los límites siguen activos hasta renovación manual.
                </span>
              </span>
            </label>
          </div>
        </div>

        {/* Límites por tipo */}
        <div>
          <label className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide block mb-2">
            {useUnifiedPool
              ? 'Tippables se consumen del pool unificado. Configura solo: producciones, reuniones, matriz.'
              : 'Límites por tipo de contenido (por ciclo)'}
          </label>
          <div className="grid grid-cols-2 gap-3 bg-fm-background rounded-xl p-4">
            {[
              { key: 'historias' as const, label: 'Historias' },
              { key: 'estaticos' as const, label: 'Estáticos' },
              { key: 'videos_cortos' as const, label: 'Videos cortos' },
              { key: 'reels' as const, label: 'Video Largo' },
              { key: 'shorts' as const, label: 'Shorts' },
              { key: 'producciones' as const, label: 'Producciones' },
              { key: 'reuniones' as const, label: 'Reuniones' },
              { key: 'reunion_duracion_horas' as const, label: 'Horas / reunión' },
              { key: 'matrices_contenido' as const, label: 'Matriz contenido' },
            ].map(({ key, label }) => {
              const isTippable = (TIPPABLE_LIMIT_KEYS as readonly string[]).includes(key)
              const lockedByPool = useUnifiedPool && isTippable
              return (
                <div
                  key={key}
                  className={`flex items-center justify-between gap-3 ${lockedByPool ? 'opacity-50' : ''}`}
                >
                  <span className="text-sm text-fm-on-surface">{label}</span>
                  <input
                    type="number"
                    min="0"
                    disabled={lockedByPool}
                    value={lockedByPool ? '' : (limits[key] ?? 0)}
                    placeholder={lockedByPool ? 'Pool' : undefined}
                    onChange={(e) => updateLimit(key, e.target.value)}
                    className="w-20 border border-fm-surface-container-high rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-fm-primary/30 disabled:cursor-not-allowed disabled:bg-fm-surface-container-high/40"
                  />
                </div>
              )
            })}
          </div>
        </div>

        {/* Distribución semanal opcional */}
        <div>
          <label className="flex items-center gap-2 cursor-pointer mb-2">
            <input
              type="checkbox"
              checked={useDistribution}
              onChange={(e) => setUseDistribution(e.target.checked)}
              className="accent-fm-primary"
            />
            <span className="text-xs font-bold text-fm-on-surface-variant uppercase tracking-wide">
              Usar distribución semanal personalizada
            </span>
          </label>
          {useDistribution && (() => {
            const weeksRender = billingPeriod === 'bimonthly' ? WEEKS_8 : WEEKS_4
            return (
              <div className="bg-fm-background rounded-xl p-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-left text-fm-on-surface-variant font-bold pb-2">Semana</th>
                      {TIPPABLE.map((t) => (
                        <th key={t} className="text-right text-fm-on-surface-variant font-bold pb-2 pl-2">
                          {CONTENT_TYPE_LABELS[t]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {weeksRender.map((w) => (
                      <tr key={w} className={billingPeriod === 'bimonthly' && (w === 'S5') ? 'border-t-2 border-fm-outline-variant/40' : ''}>
                        <td className="text-fm-on-surface font-semibold py-1">
                          {w}
                          {billingPeriod === 'bimonthly' && w === 'S5' && (
                            <span className="ml-1 text-[10px] text-fm-outline">(2do pago)</span>
                          )}
                        </td>
                        {TIPPABLE.map((t) => (
                          <td key={t} className="text-right pl-2">
                            <input
                              type="number"
                              min="0"
                              value={distribution[w]?.[t] ?? 0}
                              onChange={(e) => updateDist(w, t, e.target.value)}
                              className="w-14 border border-fm-surface-container-high rounded px-1 py-0.5 text-right"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })()}
        </div>

        {error && (
          <p className="text-xs text-fm-error font-semibold bg-fm-error/5 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <p className="text-xs text-fm-outline bg-fm-background rounded-lg px-3 py-2">
          Los cambios no afectan ciclos ya abiertos — solo nuevos ciclos usarán estos límites.
        </p>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-fm-surface-container-high rounded-full text-sm font-bold text-fm-on-surface-variant hover:bg-fm-background"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 py-2.5 bg-fm-primary text-white rounded-full text-sm font-bold hover:bg-fm-primary-dim disabled:opacity-60"
          >
            {saving ? 'Guardando…' : isEditing ? 'Guardar' : 'Crear plan'}
          </button>
        </div>
      </div>
    </div>
  )
}
