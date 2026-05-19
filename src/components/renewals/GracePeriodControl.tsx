'use client'

import { useState, useTransition } from 'react'
import { deferPaymentGracePeriod, revokeGracePeriod } from '@/app/actions/renewals'

interface Props {
  cycleId: string
  clientId: string
  /** Fecha ISO (YYYY-MM-DD) del fin de gracia, o null si no hay. */
  graceUntil: string | null
  /** Variant compacto para RenewalRow vs full para perfil del cliente. */
  variant?: 'compact' | 'full'
}

const PRESETS = [7, 14, 30] as const

function isFutureOrToday(dateStr: string): boolean {
  // Comparación de strings YYYY-MM-DD funciona lexicográficamente
  const today = new Date()
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/El_Salvador',
  }).format(today)
  return dateStr >= todayStr
}

function formatGraceDate(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-SV', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Control reusable para otorgar/extender/anular un período de gracia sobre el
 * ciclo. Se renderiza en RenewalRow (variant=compact) y en el perfil del
 * cliente (variant=full) — la lógica es idéntica.
 */
export function GracePeriodControl({
  cycleId,
  clientId,
  graceUntil,
  variant = 'compact',
}: Props) {
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<number>(7)
  const [customDays, setCustomDays] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const active = !!graceUntil && isFutureOrToday(graceUntil)

  function handleGrant() {
    setError(null)
    const customParsed = customDays.trim() ? parseInt(customDays, 10) : null
    const days = customParsed && customParsed > 0 ? customParsed : selected
    if (!Number.isInteger(days) || days < 1 || days > 60) {
      setError('Los días deben estar entre 1 y 60.')
      return
    }
    startTransition(async () => {
      const res = await deferPaymentGracePeriod(cycleId, clientId, days)
      if ('error' in res) {
        setError(res.error ?? 'Error al otorgar gracia')
        return
      }
      setEditing(false)
      setCustomDays('')
    })
  }

  function handleRevoke() {
    if (!confirm('¿Anular el período de gracia? El cliente volverá a estar bloqueado por impago.')) return
    setError(null)
    startTransition(async () => {
      const res = await revokeGracePeriod(cycleId, clientId)
      if ('error' in res) setError(res.error ?? 'Error al anular')
    })
  }

  // ── Estado: gracia vigente ──
  if (active && !editing) {
    return (
      <div className={
        variant === 'full'
          ? 'rounded-2xl border border-emerald-300/60 bg-emerald-50/60 p-5 space-y-3'
          : 'rounded-xl border border-emerald-300/60 bg-emerald-50/40 px-4 py-3 flex items-center gap-3 flex-wrap'
      }>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="material-symbols-outlined text-emerald-700 text-base">schedule</span>
          <div>
            <p className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
              Pago diferido
            </p>
            <p className="text-sm text-emerald-900">
              Hasta el <strong>{formatGraceDate(graceUntil!)}</strong>
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setEditing(true)}
            disabled={isPending}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-emerald-400/60 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
          >
            Extender
          </button>
          <button
            onClick={handleRevoke}
            disabled={isPending}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-fm-error/40 text-fm-error hover:bg-fm-error/10 disabled:opacity-50"
          >
            {isPending ? '…' : 'Anular'}
          </button>
        </div>
        {error && <p className="w-full text-xs text-fm-error font-semibold">{error}</p>}
      </div>
    )
  }

  // ── Estado: sin gracia, en edición ──
  if (editing) {
    return (
      <div className={
        variant === 'full'
          ? 'rounded-2xl border border-emerald-300/60 bg-emerald-50/60 p-5 space-y-3'
          : 'rounded-xl border border-emerald-300/60 bg-emerald-50/40 p-4 space-y-3'
      }>
        <p className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
          Diferir pago — días de gracia
        </p>

        <div className="flex gap-2 flex-wrap items-center">
          {PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => { setSelected(n); setCustomDays('') }}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                selected === n && !customDays
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-emerald-800 border-emerald-300/60 hover:bg-emerald-100'
              }`}
            >
              {n} días
            </button>
          ))}
          <input
            type="number"
            min={1}
            max={60}
            placeholder="otro"
            value={customDays}
            onChange={(e) => setCustomDays(e.target.value)}
            className="w-20 px-2 py-1 rounded-lg border border-emerald-300/60 bg-white text-xs focus:outline-none focus:border-emerald-500"
          />
        </div>

        {error && <p className="text-xs text-fm-error font-semibold">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={() => { setEditing(false); setError(null); setCustomDays('') }}
            disabled={isPending}
            className="flex-1 py-2 text-xs border border-fm-surface-container-high rounded-lg text-fm-on-surface-variant hover:bg-fm-background disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleGrant}
            disabled={isPending}
            className="flex-1 py-2 text-xs bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-50"
          >
            {isPending ? 'Otorgando…' : (active ? 'Actualizar' : 'Otorgar gracia')}
          </button>
        </div>
      </div>
    )
  }

  // ── Estado: sin gracia, idle ──
  return (
    <button
      onClick={() => setEditing(true)}
      className={
        variant === 'full'
          ? 'text-xs font-semibold px-4 py-2 rounded-full border border-emerald-400/60 text-emerald-800 hover:bg-emerald-50 transition-colors inline-flex items-center gap-1.5'
          : 'text-xs font-semibold px-3 py-1.5 rounded-lg border border-emerald-400/60 text-emerald-800 hover:bg-emerald-50 transition-colors inline-flex items-center gap-1.5'
      }
    >
      <span className="material-symbols-outlined text-sm">schedule</span>
      Diferir pago
    </button>
  )
}
