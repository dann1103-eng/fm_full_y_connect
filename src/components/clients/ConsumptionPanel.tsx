'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { ClientWithPlan, BillingCycle, Consumption, ContentType } from '@/types/db'
import { CONTENT_TYPES, CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import { groupByWeek } from '@/lib/domain/consumption'
import { ConsumptionModal } from './ConsumptionModal'
import { ConsumptionHistory } from './ConsumptionHistory'

// Material Symbols icon names per content type
const CONTENT_ICONS: Record<ContentType, string> = {
  historia: 'auto_stories',
  estatico: 'photo_camera',
  video_corto: 'movie',
  reel: 'videocam',
  short: 'slideshow',
  produccion: 'video_camera_front',
  reunion: 'groups',
}

// Amber-toned types (estatico, video_corto) get amber icon styling
const AMBER_TYPES = new Set<ContentType>(['estatico', 'video_corto'])

// Progress bar color based on percentage
function barColor(pct: number): string {
  if (pct >= 90) return '#b31b25'
  if (pct >= 70) return '#f59e0b'
  return '#00675c'
}

// Avatar gradients (consistent with dashboard)
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

const STATUS_LABELS: Record<string, string> = {
  active: 'Activo',
  paused: 'Pausado',
  overdue: 'Moroso',
}

const MONTHS_SHORT = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
const MONTHS_FULL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

interface ConsumptionPanelProps {
  client: ClientWithPlan
  cycle: BillingCycle
  consumptions: Consumption[]
  totals: Record<ContentType, number>
  limits: Record<ContentType, number>
  daysLeft: number | null
  isAdmin: boolean
  userMap: Record<string, string>
}

export function ConsumptionPanel({
  client,
  cycle,
  consumptions,
  totals,
  limits,
  daysLeft,
  isAdmin,
  userMap,
}: ConsumptionPanelProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const [markingPaid, setMarkingPaid] = useState(false)
  const [notes, setNotes] = useState(client.notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)
  const router = useRouter()

  const isOverdue = daysLeft !== null && daysLeft < 0 && cycle.payment_status === 'unpaid'

  async function handleMarkPaid() {
    setMarkingPaid(true)
    const supabase = createClient()
    await supabase
      .from('billing_cycles')
      .update({ payment_status: 'paid', payment_date: new Date().toISOString().split('T')[0] })
      .eq('id', cycle.id)
    setMarkingPaid(false)
    router.refresh()
  }

  async function handleSaveNotes() {
    setSavingNotes(true)
    const supabase = createClient()
    await supabase
      .from('clients')
      .update({ notes: notes || null })
      .eq('id', client.id)
    setSavingNotes(false)
    router.refresh()
  }

  // Cycle date formatting (UTC-safe)
  const formatDateShort = (d: string) => {
    const date = new Date(d)
    return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`
  }

  // Section header: "Abril 2026"
  const cycleStart = new Date(cycle.period_start)
  const cycleMonthLabel = `${MONTHS_FULL[cycleStart.getMonth()]} ${cycleStart.getFullYear()}`

  // Active content types (limit > 0)
  const activeTypes = CONTENT_TYPES.filter((t) => limits[t] > 0)

  // Weekly breakdown
  const weeklyGroups = groupByWeek(consumptions, cycle.period_start)
  const daysSinceStart = Math.floor(
    (Date.now() - new Date(cycle.period_start).getTime()) / (1000 * 60 * 60 * 24)
  )
  const currentWeek = Math.min(Math.floor(daysSinceStart / 7), 3)

  return (
    <>
      {/* ── Client header card ── */}
      <section className="glass-panel rounded-[2rem] p-8 flex flex-col md:flex-row items-center md:items-start justify-between gap-8">
        {/* Avatar + info */}
        <div className="flex flex-col md:flex-row items-center gap-6">
          {/* Avatar */}
          {client.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={client.logo_url}
              alt={client.name}
              className="w-20 h-20 rounded-3xl object-cover shadow-xl flex-shrink-0"
            />
          ) : (
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center text-white text-2xl font-extrabold tracking-tight shadow-xl flex-shrink-0"
              style={{ background: clientGradient(client.name) }}
            >
              {getInitials(client.name)}
            </div>
          )}

          {/* Name, plan, status, cycle date, social handles */}
          <div className="text-center md:text-left space-y-2">
            {/* Name + badges */}
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
              <h1 className="text-3xl font-extrabold tracking-tight text-[#2c2f31]">
                {client.name}
              </h1>
              <span className="px-3 py-1 bg-[#ceee93]/50 text-[#4a6319] text-xs font-extrabold rounded-full uppercase tracking-wider">
                Plan {client.plan.name}
              </span>
              <span className="px-3 py-1 bg-[#ceee93] text-[#41590f] text-xs font-extrabold rounded-full uppercase tracking-wider">
                {STATUS_LABELS[client.status] ?? client.status}
              </span>
            </div>

            {/* Cycle date + payment */}
            <p className="text-[#595c5e] text-sm flex flex-wrap items-center justify-center md:justify-start gap-1.5">
              <span className="material-symbols-outlined text-base">calendar_today</span>
              Ciclo: {formatDateShort(cycle.period_start)} – {formatDateShort(cycle.period_end)}
              &nbsp;·&nbsp; Pago: día {client.billing_day}
              {cycle.payment_status === 'paid' ? (
                <span className="px-2 py-0.5 bg-[#00675c]/10 text-[#00675c] text-[10px] font-extrabold rounded-full border border-[#00675c]/20">
                  ✓ Pagado
                </span>
              ) : isAdmin ? (
                <button
                  onClick={handleMarkPaid}
                  disabled={markingPaid}
                  className="px-2 py-0.5 bg-[#b31b25]/10 text-[#b31b25] text-[10px] font-extrabold rounded-full border border-[#b31b25]/20 hover:bg-[#b31b25]/20 transition-colors"
                >
                  {markingPaid ? '...' : 'Marcar pagado'}
                </button>
              ) : (
                <span className="px-2 py-0.5 bg-[#b31b25]/10 text-[#b31b25] text-[10px] font-extrabold rounded-full border border-[#b31b25]/20">
                  Sin pago
                </span>
              )}
            </p>

            {/* Social handles */}
            {(client.ig_handle || client.fb_handle || client.tiktok_handle) && (
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 pt-1">
                {client.ig_handle && (
                  <span className="flex items-center gap-1.5 px-3 py-1 bg-[#eef1f3] text-[#595c5e] text-[11px] font-bold rounded-full border border-[#abadaf]/20">
                    <span className="material-symbols-outlined text-sm">photo_camera</span>
                    @{client.ig_handle.replace('@', '')}
                  </span>
                )}
                {client.fb_handle && (
                  <span className="flex items-center gap-1.5 px-3 py-1 bg-[#eef1f3] text-[#595c5e] text-[11px] font-bold rounded-full border border-[#abadaf]/20">
                    <span className="material-symbols-outlined text-sm">thumb_up</span>
                    {client.fb_handle}
                  </span>
                )}
                {client.tiktok_handle && (
                  <span className="flex items-center gap-1.5 px-3 py-1 bg-[#eef1f3] text-[#595c5e] text-[11px] font-bold rounded-full border border-[#abadaf]/20">
                    <span className="material-symbols-outlined text-sm">music_note</span>
                    @{client.tiktok_handle.replace('@', '')}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 w-full md:w-auto flex-shrink-0">
          <Link
            href={`/clients/${client.id}/report`}
            className="flex-1 md:flex-none px-5 py-2.5 border-2 border-[#595c5e] text-[#595c5e] font-bold rounded-full hover:bg-[#595c5e]/5 transition-all active:scale-95 text-sm text-center flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-base">summarize</span>
            Ver reporte
          </Link>
          <Link
            href={`/clients/${client.id}/edit`}
            className="flex-1 md:flex-none px-5 py-2.5 border-2 border-[#00675c] text-[#00675c] font-bold rounded-full hover:bg-[#00675c]/5 transition-all active:scale-95 text-sm text-center"
          >
            Editar cliente
          </Link>
          <button
            onClick={() => !isOverdue && setModalOpen(true)}
            disabled={isOverdue}
            className={`flex-1 md:flex-none px-5 py-2.5 text-white font-bold rounded-full flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95 text-sm ${isOverdue ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-110'}`}
            style={{ background: isOverdue ? '#b31b25' : 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)', boxShadow: '0 4px 15px rgba(0,103,92,0.25)' }}
          >
            <span className="material-symbols-outlined text-base">{isOverdue ? 'block' : 'add'}</span>
            {isOverdue ? 'Cuenta vencida' : 'Registrar consumo'}
          </button>
        </div>
      </section>

      {/* ── Overdue warning ── */}
      {isOverdue && (
        <div className="bg-[#b31b25]/5 border border-[#b31b25]/20 rounded-2xl px-5 py-4 flex items-center gap-3">
          <span className="material-symbols-outlined text-[#b31b25] text-xl flex-shrink-0">warning</span>
          <div>
            <p className="text-sm font-semibold text-[#b31b25]">Cuenta vencida — registro de consumos bloqueado</p>
            <p className="text-xs text-[#b31b25]/80 mt-0.5">
              El ciclo venció y el pago está pendiente.
              {isAdmin ? ' Marca el pago como recibido para desbloquear.' : ' Contacta al administrador para regularizar el pago.'}
            </p>
          </div>
        </div>
      )}

      {/* ── Consumption section ── */}
      <section className="space-y-5">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-[#2c2f31]">
            Consumo del ciclo actual
          </h2>
          <p className="text-[#595c5e] font-medium text-sm mt-1">
            {cycleMonthLabel}
            {daysLeft !== null && (
              <>
                {' '}·{' '}
                <span
                  className="font-bold"
                  style={{ color: daysLeft < 0 ? '#b31b25' : daysLeft <= 3 ? '#b31b25' : '#00675c' }}
                >
                  {daysLeft < 0
                    ? 'Vencido'
                    : daysLeft === 0
                    ? 'Vence hoy'
                    : `${daysLeft} días restantes`}
                </span>
              </>
            )}
          </p>
        </div>

        {/* Consumption cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {activeTypes.map((type) => {
            const consumed = totals[type]
            const limit = limits[type]
            const pct = limit > 0 ? Math.min(100, Math.round((consumed / limit) * 100)) : 0
            const available = Math.max(0, limit - consumed)
            const rollover =
              cycle.rollover_from_previous_json?.[
                type === 'historia'
                  ? 'historias'
                  : type === 'estatico'
                  ? 'estaticos'
                  : type === 'video_corto'
                  ? 'videos_cortos'
                  : type === 'reel'
                  ? 'reels'
                  : type === 'short'
                  ? 'shorts'
                  : type === 'reunion'
                  ? 'reuniones'
                  : 'producciones'
              ] ?? 0

            const isAmber = AMBER_TYPES.has(type)
            const iconBg = isAmber ? 'bg-amber-100/60' : 'bg-[#5bf4de]/30'
            const iconColor = isAmber ? 'text-amber-600' : 'text-[#00675c]'
            const availableColor = isAmber ? '#d97706' : '#595c5e'
            const color = barColor(pct)

            return (
              <div
                key={type}
                className="glass-panel p-5 rounded-[1.5rem] hover:translate-y-[-3px] transition-transform duration-300 flex flex-col gap-3"
              >
                {/* Icon */}
                <div className={`p-2 ${iconBg} rounded-xl w-fit`}>
                  <span className={`material-symbols-outlined ${iconColor} text-xl`}>
                    {CONTENT_ICONS[type]}
                  </span>
                </div>

                {/* Label + count */}
                <div>
                  <p className="text-[#595c5e] text-[11px] font-extrabold tracking-widest uppercase">
                    {CONTENT_TYPE_LABELS[type]}
                  </p>
                  <p className="text-2xl font-black text-[#2c2f31] mt-0.5">
                    {consumed}{' '}
                    <span className="text-base font-medium text-[#747779]">
                      / {limit}
                      {rollover > 0 && (
                        <span className="text-[10px] text-[#4a6319] ml-1">(+{rollover})</span>
                      )}
                    </span>
                  </p>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-[#e5e9eb] rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                  />
                </div>

                {/* Available */}
                <p className="text-[11px] font-bold" style={{ color: availableColor }}>
                  {available} disponibles
                </p>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Weekly breakdown ── */}
      <section className="space-y-5">
        <h3 className="text-xl font-extrabold tracking-tight text-[#2c2f31]">
          Desglose semanal
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((weekIdx) => {
            const weekKey = `S${weekIdx + 1}`
            const weekLabel = `Semana ${weekIdx + 1}`
            const items = weeklyGroups[weekKey] ?? []
            const isCurrent = weekIdx === currentWeek
            const isFuture = weekIdx > currentWeek

            // Per-type counts
            const countByType = items.reduce<Partial<Record<ContentType, number>>>((acc, c) => {
              const t = c.content_type as ContentType
              acc[t] = (acc[t] ?? 0) + 1
              return acc
            }, {})
            const presentTypes = Object.entries(countByType) as [ContentType, number][]

            // Future week with no consumptions → hourglass
            if (isFuture && items.length === 0) {
              return (
                <div
                  key={weekKey}
                  className="glass-panel p-5 rounded-[1.5rem] opacity-40 flex flex-col items-center justify-center gap-2 min-h-[140px]"
                >
                  <span className="material-symbols-outlined text-[#595c5e] text-3xl">
                    hourglass_empty
                  </span>
                  <p className="text-[#595c5e] text-[11px] font-extrabold uppercase tracking-widest text-center">
                    {weekLabel}
                  </p>
                  <p className="text-[11px] text-[#595c5e] text-center">Pendiente</p>
                </div>
              )
            }

            return (
              <div
                key={weekKey}
                className="glass-panel p-5 rounded-[1.5rem]"
                style={
                  isCurrent
                    ? {
                        background: 'rgba(0, 103, 92, 0.05)',
                        border: '2px solid rgba(0, 103, 92, 0.3)',
                      }
                    : {}
                }
              >
                {/* Header */}
                <div className="flex justify-between items-start mb-4">
                  <p
                    className="text-[11px] font-extrabold uppercase tracking-widest"
                    style={{ color: isCurrent ? '#00675c' : '#595c5e' }}
                  >
                    {weekLabel}
                    {isCurrent && ' · Actual'}
                  </p>
                  {isCurrent && (
                    <span className="flex h-2 w-2 rounded-full bg-[#00675c] animate-pulse flex-shrink-0" />
                  )}
                </div>

                {/* Per-type rows */}
                {presentTypes.length === 0 ? (
                  <p className="text-xs text-[#abadaf]">Sin consumos</p>
                ) : (
                  <div className="space-y-2.5">
                    {presentTypes.map(([type, count]) => (
                      <div key={type} className="flex justify-between items-center text-sm">
                        <span className="flex items-center gap-1.5 text-[#595c5e] font-medium">
                          <span className="material-symbols-outlined text-base">
                            {CONTENT_ICONS[type]}
                          </span>
                          {CONTENT_TYPE_LABELS[type]}
                        </span>
                        <span className="font-extrabold text-[#2c2f31]">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ── History + Notes grid ── */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Cycle history — col-span-7 */}
        <div className="lg:col-span-7 space-y-4">
          <h3 className="text-xl font-extrabold tracking-tight text-[#2c2f31]">
            Historial del ciclo
          </h3>
          <ConsumptionHistory
            consumptions={consumptions}
            isAdmin={isAdmin}
            cycleId={cycle.id}
            userMap={userMap}
          />
        </div>

        {/* Internal notes — col-span-5 */}
        <div className="lg:col-span-5 space-y-4">
          <h3 className="text-xl font-extrabold tracking-tight text-[#2c2f31]">
            Notas internas
          </h3>
          <div className="glass-panel p-6 rounded-[2rem] flex flex-col" style={{ minHeight: '340px' }}>
            <textarea
              className="flex-1 w-full bg-transparent border border-[#abadaf]/30 rounded-2xl p-4 text-sm text-[#2c2f31] placeholder:text-[#747779]/50 resize-none outline-none transition-all focus:border-[#00675c]/50 focus:ring-2 focus:ring-[#5bf4de]/40"
              rows={8}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notas internas sobre el cliente..."
            />
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleSaveNotes}
                disabled={savingNotes}
                className="px-6 py-2.5 text-white font-bold rounded-full shadow-lg hover:scale-[1.02] transition-transform active:scale-95 text-sm disabled:opacity-60"
                style={{
                  background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)',
                  boxShadow: '0 4px 15px rgba(0,103,92,0.2)',
                }}
              >
                {savingNotes ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Consumption modal */}
      <ConsumptionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        client={client}
        cycle={cycle}
        totals={totals}
        limits={limits}
        isAdmin={isAdmin}
      />
    </>
  )
}
