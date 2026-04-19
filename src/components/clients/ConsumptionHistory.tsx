'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Consumption, ContentType } from '@/types/db'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'

// Material Symbols icon per content type
const CONTENT_ICONS: Record<ContentType, string> = {
  historia: 'auto_stories',
  estatico: 'photo_camera',
  video_corto: 'movie',
  reel: 'videocam',
  short: 'slideshow',
  produccion: 'video_camera_front',
  reunion: 'groups',
}

// Amber-toned types get amber icon styling, others get primary
const AMBER_TYPES = new Set<ContentType>(['estatico', 'video_corto'])

// Human-readable type action label
const TYPE_ACTION: Record<ContentType, string> = {
  historia: 'Historia registrada',
  estatico: 'Estático registrado',
  video_corto: 'Video corto registrado',
  reel: 'Reel registrado',
  short: 'Short registrado',
  produccion: 'Producción registrada',
  reunion: 'Reunión registrada',
}

function daysAgo(dateStr: string): string {
  const date = new Date(dateStr)
  const diffMs = Date.now() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'hoy'
  if (diffDays === 1) return 'hace 1 día'
  if (diffDays < 7) return `hace ${diffDays} días`
  if (diffDays < 14) return 'hace 1 semana'
  if (diffDays < 21) return 'hace 2 semanas'
  return `hace ${Math.floor(diffDays / 7)} semanas`
}

interface ConsumptionHistoryProps {
  consumptions: Consumption[]
  isAdmin: boolean
  cycleId: string
  userMap: Record<string, string>
  maxCambios: number
}

export function ConsumptionHistory({
  consumptions,
  isAdmin,
  userMap,
  maxCambios,
}: ConsumptionHistoryProps) {
  const router = useRouter()
  const [voidingId, setVoidingId] = useState<string | null>(null)
  const [incrementingId, setIncrementingId] = useState<string | null>(null)

  async function handleVoid(consumptionId: string) {
    setVoidingId(consumptionId)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('consumptions').update({
      voided: true,
      voided_by_user_id: user?.id,
      voided_at: new Date().toISOString(),
    }).eq('id', consumptionId)
    setVoidingId(null)
    router.refresh()
  }

  async function handleAddCambio(consumptionId: string) {
    setIncrementingId(consumptionId)
    const supabase = createClient()
    await supabase
      .from('consumptions')
      .update({ cambios_count: (consumptions.find(c => c.id === consumptionId)?.cambios_count ?? 0) + 1 })
      .eq('id', consumptionId)
    setIncrementingId(null)
    router.refresh()
  }

  if (consumptions.length === 0) {
    return (
      <div className="glass-panel rounded-[2rem] p-8 text-center">
        <p className="text-sm text-[#595c5e]">Sin registros de consumo en este ciclo.</p>
      </div>
    )
  }

  return (
    <div className="glass-panel rounded-[2rem] overflow-hidden">
      <div className="divide-y divide-[#dfe3e6]/60">
        {consumptions.map((c) => {
          const type = c.content_type as ContentType
          const isAmber = AMBER_TYPES.has(type)
          const iconBg = isAmber ? 'bg-amber-100/60' : 'bg-[#5bf4de]/30'
          const iconColor = isAmber ? 'text-amber-600' : 'text-[#00675c]'
          const userName = userMap[c.registered_by_user_id] ?? 'Operador'

          return (
            <div
              key={c.id}
              className={`px-6 py-4 flex items-center justify-between hover:bg-[#eef1f3] transition-colors ${
                c.voided ? 'opacity-40' : ''
              }`}
            >
              <div className="flex items-center gap-4">
                {/* Icon box */}
                <div className={`p-2 ${iconBg} rounded-xl flex-shrink-0`}>
                  <span className={`material-symbols-outlined ${iconColor} text-base`}>
                    {CONTENT_ICONS[type]}
                  </span>
                </div>

                {/* Text */}
                <div>
                  <p className="text-sm font-bold text-[#2c2f31]">
                    {c.title || TYPE_ACTION[type] || CONTENT_TYPE_LABELS[type]}
                    {c.voided && (
                      <span className="ml-2 text-xs font-medium text-[#747779] bg-[#abadaf]/20 px-1.5 py-0.5 rounded">
                        Anulado
                      </span>
                    )}
                    {c.over_limit && !c.voided && (
                      <span className="ml-2 text-xs font-medium text-[#b31b25] bg-[#b31b25]/10 px-1.5 py-0.5 rounded">
                        Excedente
                      </span>
                    )}
                    {/* Cambios badge */}
                    {!c.voided && type !== 'produccion' && type !== 'reunion' && (() => {
                      const isOver = c.cambios_count >= maxCambios
                      return (
                        <span className={`ml-2 text-xs font-medium px-1.5 py-0.5 rounded ${
                          isOver
                            ? 'text-[#b31b25] bg-[#b31b25]/10'
                            : 'text-[#595c5e] bg-[#abadaf]/20'
                        }`}>
                          {c.cambios_count}/{maxCambios} cambios
                        </span>
                      )
                    })()}
                  </p>
                  <p className="text-xs text-[#595c5e] mt-0.5">
                    <span className="text-[#abadaf]">{CONTENT_TYPE_LABELS[type]}</span>
                    {c.notes && <span> — {c.notes}</span>}
                  </p>
                  <p className="text-xs text-[#595c5e] mt-0.5">
                    {daysAgo(c.registered_at)}&nbsp;·&nbsp;por{' '}
                    <span className="font-semibold text-[#2c2f31]">{userName}</span>
                  </p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                {/* +1 cambio */}
                {!c.voided && type !== 'produccion' && type !== 'reunion' && (
                  <button
                    onClick={() => handleAddCambio(c.id)}
                    disabled={incrementingId === c.id}
                    className={`text-xs font-bold transition-colors disabled:opacity-30 ${
                      c.cambios_count >= maxCambios
                        ? 'text-[#b31b25] hover:underline'
                        : 'text-[#00675c] hover:underline'
                    }`}
                  >
                    {incrementingId === c.id ? '...' : '+1 cambio'}
                  </button>
                )}
                {/* Void button */}
                {!c.voided && (
                  <button
                    onClick={() => handleVoid(c.id)}
                    disabled={voidingId === c.id || !isAdmin}
                    className="text-[#b31b25] text-xs font-bold hover:underline transition-colors disabled:opacity-30"
                  >
                    {voidingId === c.id ? '...' : 'Anular'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
