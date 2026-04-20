'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { ClientWithPlan, BillingCycle, CambiosPackage, ExtraContentItem, Requirement, RequirementCambioLog, ContentType } from '@/types/db'
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, limitsToRecord } from '@/lib/domain/plans'
import { groupByWeek, effectiveWeeklyTarget, resolveDistribution, augmentDistribution, computeWeeklyBreakdownWithCascade } from '@/lib/domain/requirement'
import { RequirementModal } from './RequirementModal'
import { RequirementHistory } from './RequirementHistory'

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

// Simple (non-pipeline) content types
const SIMPLE_TYPES: ContentType[] = ['produccion', 'reunion']

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

interface RequirementPanelProps {
  client: ClientWithPlan
  cycle: BillingCycle
  requirements: Requirement[]
  totals: Record<ContentType, number>
  limits: Record<ContentType, number>
  daysLeft: number | null
  isAdmin: boolean
  canCreate?: boolean
  canAssign?: boolean
  userMap: Record<string, string>
  assignableUsers?: { id: string; full_name: string }[]
  cambioLogsMap?: Record<string, RequirementCambioLog[]>
}

export function RequirementPanel({
  client,
  cycle,
  requirements,
  totals,
  limits,
  daysLeft,
  isAdmin,
  canCreate = false,
  canAssign = false,
  userMap,
  assignableUsers = [],
  cambioLogsMap = {},
}: RequirementPanelProps) {
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
  const pipelineTypes = activeTypes.filter((t) => !SIMPLE_TYPES.includes(t))
  const simpleTypes = activeTypes.filter((t) => SIMPLE_TYPES.includes(t))

  // Weekly breakdown
  const weeklyGroups = groupByWeek(requirements, cycle.period_start)
  const daysSinceStart = Math.floor(
    (new Date().getTime() - new Date(cycle.period_start).getTime()) / (1000 * 60 * 60 * 24)
  )
  const currentWeek = Math.min(Math.floor(daysSinceStart / 7), 3)

  const weekDist = resolveDistribution(
    (client as { weekly_distribution_json?: import('@/types/db').WeeklyDistribution | null }).weekly_distribution_json,
    client.plan?.default_weekly_distribution_json,
  )
  const effectiveDist = weekDist
    ? augmentDistribution(weekDist, pipelineTypes, limits)
    : null
  const weekBreakdown = effectiveDist
    ? computeWeeklyBreakdownWithCascade(requirements, effectiveDist, currentWeek)
    : null

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
            {(client.ig_handle || client.fb_handle || client.tiktok_handle ||
              client.yt_handle || client.linkedin_handle || client.website_url || client.other_contact) && (
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
                {client.yt_handle && (
                  <span className="flex items-center gap-1.5 px-3 py-1 bg-[#eef1f3] text-[#595c5e] text-[11px] font-bold rounded-full border border-[#abadaf]/20">
                    <span className="material-symbols-outlined text-sm">play_circle</span>
                    {client.yt_handle}
                  </span>
                )}
                {client.linkedin_handle && (
                  <span className="flex items-center gap-1.5 px-3 py-1 bg-[#eef1f3] text-[#595c5e] text-[11px] font-bold rounded-full border border-[#abadaf]/20">
                    <span className="material-symbols-outlined text-sm">work</span>
                    {client.linkedin_handle}
                  </span>
                )}
                {client.website_url && (
                  <a
                    href={client.website_url.startsWith('http') ? client.website_url : `https://${client.website_url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1 bg-[#eef1f3] text-[#595c5e] text-[11px] font-bold rounded-full border border-[#abadaf]/20 hover:bg-[#00675c]/10 transition-colors"
                  >
                    <span className="material-symbols-outlined text-sm">language</span>
                    {client.website_url.replace(/^https?:\/\//, '')}
                  </a>
                )}
                {client.other_contact && (
                  <span className="flex items-center gap-1.5 px-3 py-1 bg-[#eef1f3] text-[#595c5e] text-[11px] font-bold rounded-full border border-[#abadaf]/20">
                    <span className="material-symbols-outlined text-sm">alternate_email</span>
                    {client.other_contact}
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
          {canCreate && (
            <button
              onClick={() => !isOverdue && setModalOpen(true)}
              disabled={isOverdue}
              className={`flex-1 md:flex-none px-5 py-2.5 text-white font-bold rounded-full flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95 text-sm ${isOverdue ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-110'}`}
              style={{ background: isOverdue ? '#b31b25' : 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)', boxShadow: '0 4px 15px rgba(0,103,92,0.25)' }}
            >
              <span className="material-symbols-outlined text-base">{isOverdue ? 'block' : 'add'}</span>
              {isOverdue ? 'Cuenta vencida' : 'Registrar requerimiento'}
            </button>
          )}
        </div>
      </section>

      {/* ── Overdue warning ── */}
      {isOverdue && (
        <div className="bg-[#b31b25]/5 border border-[#b31b25]/20 rounded-2xl px-5 py-4 flex items-center gap-3">
          <span className="material-symbols-outlined text-[#b31b25] text-xl flex-shrink-0">warning</span>
          <div>
            <p className="text-sm font-semibold text-[#b31b25]">Cuenta vencida — registro de requerimientos bloqueado</p>
            <p className="text-xs text-[#b31b25]/80 mt-0.5">
              El ciclo venció y el pago está pendiente.
              {isAdmin ? ' Marca el pago como recibido para desbloquear.' : ' Contacta al administrador para regularizar el pago.'}
            </p>
          </div>
        </div>
      )}

      {/* ── Requerimientos del ciclo ── */}
      <section className="space-y-5">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-[#2c2f31]">
            Requerimientos del ciclo actual
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

        {/* Requirement cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {activeTypes.map((type) => {
            const consumed = totals[type]
            const snapshotLimits = limitsToRecord(cycle.limits_snapshot_json)
            const overrides = cycle.content_limits_override_json as Partial<Record<ContentType, number>> | null
            const baseLimit = overrides?.[type] ?? snapshotLimits[type]
            const extraSold = (cycle.extra_content_json as ExtraContentItem[])
              ?.filter((e) => e.content_type === type)
              .reduce((s, e) => s + e.qty, 0) ?? 0
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

            const effectiveTotal = baseLimit + rollover + extraSold
            const pct = effectiveTotal > 0 ? Math.min(100, Math.round((consumed / effectiveTotal) * 100)) : 0
            const available = Math.max(0, effectiveTotal - consumed)

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
                      / {baseLimit}
                      {rollover > 0 && (
                        <span className="text-[10px] text-[#4a6319] ml-1">(+{rollover})</span>
                      )}
                      {extraSold > 0 && (
                        <span className="text-[10px] text-[#006385] ml-1">(+{extraSold})</span>
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

        {/* Cambios counter */}
        {(() => {
          const packages = (cycle.cambios_packages_json as CambiosPackage[]) ?? []
          const pkgTotal = packages.reduce((s, p) => s + p.qty, 0)
          const planBase = client.plan.cambios_included
          const totalBudget = planBase + pkgTotal
          const used = requirements.filter(r => !r.voided).reduce((s, r) => s + r.cambios_count, 0)
          const available = Math.max(0, totalBudget - used)
          const pct = totalBudget > 0 ? Math.min(100, Math.round((used / totalBudget) * 100)) : 0
          const color = pct >= 90 ? '#b31b25' : pct >= 70 ? '#f59e0b' : '#00675c'

          return (
            <div className="glass-panel rounded-2xl px-5 py-3 flex items-center gap-6 flex-wrap">
              <p className="text-[11px] font-extrabold text-[#abadaf] uppercase tracking-widest shrink-0">
                Cambios del ciclo
              </p>

              <div className="flex items-center gap-3">
                {/* Short progress bar */}
                <div className="w-32 bg-[#e5e9eb] rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                  />
                </div>
                <p className="text-xs font-bold shrink-0" style={{ color }}>
                  {used} / {totalBudget}
                </p>
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#dfe3e6]" />
                  <span className="text-[11px] text-[#595c5e]">
                    Plan: <strong className="text-[#2c2f31]">{planBase}</strong>
                  </span>
                </div>
                {pkgTotal > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#5bf4de]" />
                    <span className="text-[11px] text-[#595c5e]">
                      Comprados: <strong className="text-[#00675c]">+{pkgTotal}</strong>
                      {packages.length > 0 && (
                        <span className="ml-1 text-[#abadaf]">
                          ({packages.map(p => `${p.qty}${p.note ? ` — ${p.note}` : ''}`).join(', ')})
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>

              <p className="text-[11px] font-bold ml-auto shrink-0" style={{ color: available === 0 ? '#b31b25' : '#595c5e' }}>
                {available} disponibles
              </p>
            </div>
          )
        })()}
      </section>

      {/* ── Desglose semanal ── */}
      <section className="space-y-5">
        <h3 className="text-xl font-extrabold tracking-tight text-[#2c2f31]">
          Desglose semanal
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {weekBreakdown
            ? weekBreakdown.map((week) => {
                const weekLabel = `Semana ${week.label.slice(1)}`
                const isFuture = !week.isCurrent && ['S1','S2','S3','S4'].indexOf(week.label) > currentWeek
                const budgetTypes = pipelineTypes.filter(t => (week.budget[t] ?? 0) > 0)
                const hasActivity = pipelineTypes.some(t => (week.counts[t] ?? 0) > 0 || (week.overflow[t] ?? 0) > 0)

                return (
                  <div
                    key={week.label}
                    className="glass-panel p-5 rounded-[1.5rem]"
                    style={week.isCurrent ? { background: 'rgba(0,103,92,0.05)', border: '2px solid rgba(0,103,92,0.3)' } : {}}
                  >
                    <div className="flex justify-between items-start mb-4">
                      <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: week.isCurrent ? '#00675c' : '#595c5e' }}>
                        {weekLabel}{week.isCurrent && ' · Actual'}
                      </p>
                      {week.isCurrent && <span className="flex h-2 w-2 rounded-full bg-[#00675c] animate-pulse flex-shrink-0" />}
                    </div>

                    {budgetTypes.length === 0 && !hasActivity ? (
                      <p className="text-xs text-[#abadaf]">{isFuture ? 'Pendiente' : 'Sin actividad'}</p>
                    ) : (
                      <div className="space-y-3">
                        {(budgetTypes.length > 0 ? budgetTypes : pipelineTypes.filter(t => (week.counts[t] ?? 0) > 0)).map((type) => {
                          const consumed = week.counts[type] ?? 0
                          const budget = week.budget[type] ?? 0
                          const extra = week.overflow[type] ?? 0
                          const pct = budget > 0 ? Math.min(100, Math.round((consumed / budget) * 100)) : 0
                          const weekBarColor = isFuture ? '#e5e9eb' : consumed >= budget && budget > 0 ? '#00675c' : '#f59e0b'
                          return (
                            <div key={type}>
                              <div className="flex justify-between items-center mb-1">
                                <span className="flex items-center gap-1 text-[11px] text-[#595c5e] font-medium">
                                  <span className="material-symbols-outlined text-sm">{CONTENT_ICONS[type]}</span>
                                  {CONTENT_TYPE_LABELS[type]}
                                </span>
                                <div className="flex items-center gap-1">
                                  <span className="text-[11px] font-bold text-[#2c2f31]">
                                    {consumed}<span className="font-normal text-[#abadaf]">/{budget}</span>
                                  </span>
                                  {extra > 0 && (
                                    <span className="text-[9px] font-bold px-1 py-0.5 rounded-full bg-[#b31b25]/10 text-[#b31b25]">
                                      +{extra}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {budget > 0 && (
                                <div className="w-full bg-[#e5e9eb] rounded-full h-1.5 overflow-hidden">
                                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: weekBarColor }} />
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })
            : [0, 1, 2, 3].map((weekIdx) => {
                const weekKey = `S${weekIdx + 1}`
                const weekLabel = `Semana ${weekIdx + 1}`
                const items = weeklyGroups[weekKey] ?? []
                const isCurrent = weekIdx === currentWeek
                const isFuture = weekIdx > currentWeek

                if (isFuture && items.length === 0) {
                  return (
                    <div key={weekKey} className="glass-panel p-5 rounded-[1.5rem] opacity-40 flex flex-col items-center justify-center gap-2 min-h-[140px]">
                      <span className="material-symbols-outlined text-[#595c5e] text-3xl">hourglass_empty</span>
                      <p className="text-[#595c5e] text-[11px] font-extrabold uppercase tracking-widest text-center">{weekLabel}</p>
                      <p className="text-[11px] text-[#595c5e] text-center">Pendiente</p>
                    </div>
                  )
                }

                return (
                  <div key={weekKey} className="glass-panel p-5 rounded-[1.5rem]" style={isCurrent ? { background: 'rgba(0,103,92,0.05)', border: '2px solid rgba(0,103,92,0.3)' } : {}}>
                    <div className="flex justify-between items-start mb-4">
                      <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: isCurrent ? '#00675c' : '#595c5e' }}>
                        {weekLabel}{isCurrent && ' · Actual'}
                      </p>
                      {isCurrent && <span className="flex h-2 w-2 rounded-full bg-[#00675c] animate-pulse flex-shrink-0" />}
                    </div>
                    {items.length === 0 ? (
                      <p className="text-xs text-[#abadaf]">Sin requerimientos</p>
                    ) : (
                      <div className="space-y-3">
                        {pipelineTypes.map((type) => {
                          const consumed = items.filter(r => r.content_type === type && !r.voided && !r.carried_over).length
                          const target = effectiveWeeklyTarget(type, limits[type], client.weekly_targets_json ?? null)
                          const pct = target > 0 ? Math.min(100, Math.round((consumed / target) * 100)) : 0
                          const weekBarColor = isFuture ? '#e5e9eb' : consumed >= target ? '#00675c' : '#f59e0b'
                          return (
                            <div key={type}>
                              <div className="flex justify-between items-center mb-1">
                                <span className="flex items-center gap-1 text-[11px] text-[#595c5e] font-medium">
                                  <span className="material-symbols-outlined text-sm">{CONTENT_ICONS[type]}</span>
                                  {CONTENT_TYPE_LABELS[type]}
                                </span>
                                <span className="text-[11px] font-bold text-[#2c2f31]">
                                  {consumed}<span className="font-normal text-[#abadaf]">/{target}</span>
                                </span>
                              </div>
                              <div className="w-full bg-[#e5e9eb] rounded-full h-1.5 overflow-hidden">
                                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: weekBarColor }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })
          }
        </div>
      </section>

      {/* ── Producciones y reuniones del mes ── */}
      {simpleTypes.length > 0 && (
        <section className="space-y-5">
          <h3 className="text-xl font-extrabold tracking-tight text-[#2c2f31]">
            Producciones y reuniones del mes
          </h3>
          {/* Counter */}
          <div className="flex gap-4 flex-wrap">
            {simpleTypes.map((type) => {
              const count = requirements.filter(
                (r) => r.content_type === type && !r.voided && !r.carried_over
              ).length
              return (
                <div key={type} className="flex items-center gap-2 px-4 py-2 glass-panel rounded-2xl">
                  <span className="material-symbols-outlined text-[#00675c] text-base">
                    {CONTENT_ICONS[type]}
                  </span>
                  <span className="text-sm font-bold text-[#2c2f31]">
                    {count} {count !== 1
                      ? (type === 'produccion' ? 'producciones' : 'reuniones')
                      : CONTENT_TYPE_LABELS[type].toLowerCase()
                    }
                  </span>
                </div>
              )
            })}
          </div>
          {/* List of entries */}
          <div className="glass-panel rounded-[2rem] overflow-hidden">
            {(() => {
              const simpleEntries = requirements
                .filter((r) => simpleTypes.includes(r.content_type as ContentType) && !r.voided)
                .sort((a, b) => new Date(b.registered_at).getTime() - new Date(a.registered_at).getTime())

              if (simpleEntries.length === 0) {
                return (
                  <div className="p-8 text-center">
                    <p className="text-sm text-[#595c5e]">Sin registros este ciclo.</p>
                  </div>
                )
              }

              return (
                <div className="divide-y divide-[#dfe3e6]/60">
                  {simpleEntries.map((r) => {
                    const type = r.content_type as ContentType
                    const date = new Date(r.registered_at)
                    const dateStr = `${date.getDate()} ${['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][date.getMonth()]} ${date.getFullYear()}`
                    return (
                      <div key={r.id} className="px-6 py-4 flex items-start gap-4">
                        <div className="p-2 bg-[#5bf4de]/30 rounded-xl flex-shrink-0 mt-0.5">
                          <span className="material-symbols-outlined text-[#00675c] text-base">
                            {CONTENT_ICONS[type]}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-[#2c2f31]">
                            {CONTENT_TYPE_LABELS[type]} — {dateStr}
                          </p>
                          {r.notes && (
                            <p className="text-xs text-[#595c5e] mt-0.5">{r.notes}</p>
                          )}
                          {r.title && (
                            <p className="text-xs text-[#747779] mt-0.5 italic">{r.title}</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </section>
      )}

      {/* ── History + Notes grid ── */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Cycle history — col-span-7 */}
        <div className="lg:col-span-7 space-y-4">
          <h3 className="text-xl font-extrabold tracking-tight text-[#2c2f31]">
            Historial del ciclo
          </h3>
          <RequirementHistory
            requirements={requirements}
            isAdmin={isAdmin}
            cycleId={cycle.id}
            userMap={userMap}
            cambioLogsMap={cambioLogsMap}
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

      {/* Requirement modal */}
      <RequirementModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        client={client}
        cycle={cycle}
        totals={totals}
        limits={limits}
        isAdmin={isAdmin}
        canAssign={canAssign}
        assignableUsers={assignableUsers}
      />
    </>
  )
}
