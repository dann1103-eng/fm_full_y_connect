'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Plan, PlanLimits, WeeklyDistribution, ContentType, WeekKey } from '@/types/db'
import { createPlan, updatePlan, type PlanInput } from '@/app/actions/plans'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'

const WEEKS: WeekKey[] = ['S1', 'S2', 'S3', 'S4']
const TIPPABLE: ContentType[] = ['historia', 'estatico', 'video_corto', 'reel', 'short']

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

function emptyDistribution(): WeeklyDistribution {
  return {
    S1: { historia: 0, estatico: 0, video_corto: 0, reel: 0, short: 0 },
    S2: { historia: 0, estatico: 0, video_corto: 0, reel: 0, short: 0 },
    S3: { historia: 0, estatico: 0, video_corto: 0, reel: 0, short: 0 },
    S4: { historia: 0, estatico: 0, video_corto: 0, reel: 0, short: 0 },
  }
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
  const [limits, setLimits] = useState<PlanLimits>(plan?.limits_json ?? emptyLimits())
  const [distribution, setDistribution] = useState<WeeklyDistribution>(
    plan?.default_weekly_distribution_json ?? emptyDistribution()
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
  const [saving, setSaving] = useState(false)
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
      limits_json: limits,
      default_weekly_distribution_json: useDistribution ? distribution : null,
      unified_content_limit: unified,
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
      <div className="bg-white rounded-[2rem] p-8 w-full max-w-2xl space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-extrabold text-[#2c2f31]">
            {isEditing ? 'Editar plan' : 'Crear plan'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-[#f5f7f9] text-[#595c5e]"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Datos generales */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wide">
              Nombre
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Premium Plus"
              className="mt-1.5 w-full border border-[#dfe3e6] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wide">
              Precio (USD)
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={priceUsd}
              onChange={(e) => setPriceUsd(e.target.value)}
              placeholder="200"
              className="mt-1.5 w-full border border-[#dfe3e6] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wide">
              Cambios incluidos
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={cambiosIncluded}
              onChange={(e) => setCambiosIncluded(e.target.value)}
              className="mt-1.5 w-full border border-[#dfe3e6] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="accent-[#00675c]"
              />
              <span className="text-sm font-medium text-[#2c2f31]">Plan activo</span>
            </label>
          </div>
        </div>

        {/* Pool unificado (plan Contenido) */}
        <div className="bg-[#f5f7f9] rounded-xl p-4 space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useUnifiedPool}
              onChange={(e) => setUseUnifiedPool(e.target.checked)}
              className="accent-[#00675c]"
            />
            <span className="text-xs font-bold text-[#595c5e] uppercase tracking-wide">
              Plan Contenido (pool unificado)
            </span>
          </label>
          {useUnifiedPool && (
            <div className="flex items-center gap-3 pl-6">
              <span className="text-sm text-[#2c2f31]">Total de contenidos tippables:</span>
              <input
                type="number"
                min="1"
                value={unifiedPoolSize}
                onChange={(e) => setUnifiedPoolSize(e.target.value)}
                className="w-20 border border-[#dfe3e6] rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
              />
              <span className="text-xs text-[#747779]">
                (estáticos + videos cortos + reels + shorts comparten este pool)
              </span>
            </div>
          )}
        </div>

        {/* Límites por tipo */}
        <div>
          <label className="text-xs font-bold text-[#595c5e] uppercase tracking-wide block mb-2">
            {useUnifiedPool
              ? 'Límites extra (historias, producciones, reuniones, matriz) — tippables ignoran estos valores'
              : 'Límites por tipo de contenido (por ciclo)'}
          </label>
          <div className="grid grid-cols-2 gap-3 bg-[#f5f7f9] rounded-xl p-4">
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
            ].map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <span className="text-sm text-[#2c2f31]">{label}</span>
                <input
                  type="number"
                  min="0"
                  value={limits[key] ?? 0}
                  onChange={(e) => updateLimit(key, e.target.value)}
                  className="w-20 border border-[#dfe3e6] rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Distribución semanal opcional */}
        <div>
          <label className="flex items-center gap-2 cursor-pointer mb-2">
            <input
              type="checkbox"
              checked={useDistribution}
              onChange={(e) => setUseDistribution(e.target.checked)}
              className="accent-[#00675c]"
            />
            <span className="text-xs font-bold text-[#595c5e] uppercase tracking-wide">
              Usar distribución semanal personalizada
            </span>
          </label>
          {useDistribution && (
            <div className="bg-[#f5f7f9] rounded-xl p-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-[#595c5e] font-bold pb-2">Semana</th>
                    {TIPPABLE.map((t) => (
                      <th key={t} className="text-right text-[#595c5e] font-bold pb-2 pl-2">
                        {CONTENT_TYPE_LABELS[t]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {WEEKS.map((w) => (
                    <tr key={w}>
                      <td className="text-[#2c2f31] font-semibold py-1">{w}</td>
                      {TIPPABLE.map((t) => (
                        <td key={t} className="text-right pl-2">
                          <input
                            type="number"
                            min="0"
                            value={distribution[w]?.[t] ?? 0}
                            onChange={(e) => updateDist(w, t, e.target.value)}
                            className="w-14 border border-[#dfe3e6] rounded px-1 py-0.5 text-right"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {error && (
          <p className="text-xs text-[#b31b25] font-semibold bg-[#b31b25]/5 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <p className="text-xs text-[#747779] bg-[#f5f7f9] rounded-lg px-3 py-2">
          Los cambios no afectan ciclos ya abiertos — solo nuevos ciclos usarán estos límites.
        </p>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-[#dfe3e6] rounded-full text-sm font-bold text-[#595c5e] hover:bg-[#f5f7f9]"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 py-2.5 bg-[#00675c] text-white rounded-full text-sm font-bold hover:bg-[#005047] disabled:opacity-60"
          >
            {saving ? 'Guardando…' : isEditing ? 'Guardar' : 'Crear plan'}
          </button>
        </div>
      </div>
    </div>
  )
}
