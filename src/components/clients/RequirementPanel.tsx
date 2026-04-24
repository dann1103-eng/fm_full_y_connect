'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { ClientWithPlan, BillingCycle, CambiosPackage, ExtraContentItem, Requirement, RequirementCambioLog, ContentType } from '@/types/db'
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, limitsToRecord, applyUnifiedPool, unifiedPoolUsage, TIPPABLE_CONTENT_TYPES, rolloverToContentType } from '@/lib/domain/plans'
import {
  resolveDistribution,
  computeWeeklyBreakdownWithCascade,
  dominantCycleMonth,
  isWeekUnlocked,
  historiaBreakdown,
} from '@/lib/domain/requirement'
import { augmentDistribution, applyOverride, addRollover } from '@/lib/domain/weekly-distribution'
import { CONTENT_ICONS } from '@/lib/domain/content-icons'
import { socialUrl, type SocialNetwork } from '@/lib/domain/social'
import { RequirementModal } from './RequirementModal'
import { RequirementHistory } from './RequirementHistory'
import { renewContentPackage } from '@/app/actions/contentPackage'

// Simple (non-pipeline) content types — counters only, sin distribución semanal
const SIMPLE_TYPES: ContentType[] = ['produccion', 'reunion']
// Counter-only: se excluyen del desglose semanal (solo aparecen como contadores)
const COUNTER_ONLY_TYPES: ContentType[] = ['matriz_contenido', 'produccion', 'reunion']

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

function SocialChip({
  network,
  handle,
  icon,
  display,
}: {
  network: SocialNetwork
  handle: string
  icon: string
  display: string
}) {
  return (
    <a
      href={socialUrl(network, handle)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 px-3 py-1 bg-fm-surface-container-low text-fm-on-surface-variant text-[11px] font-bold rounded-full border border-fm-outline-variant/20 hover:bg-fm-primary/10 hover:text-fm-primary transition-colors"
    >
      <span className="material-symbols-outlined text-sm">{icon}</span>
      {display}
    </a>
  )
}

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
  assignableUsers?: { id: string; full_name: string; default_assignee?: boolean }[]
  cambioLogsMap?: Record<string, RequirementCambioLog[]>
  /** Si true, omite la sección "Historial del ciclo + Notas internas" al final del panel.
   *  Útil cuando el padre quiere renderizarla en una posición diferente. */
  hideHistorySection?: boolean
  /** Si true, oculta los action buttons del admin (Ver reporte, Editar cliente,
   *  Registrar requerimiento). Usado por el portal del cliente. */
  portalMode?: boolean
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
  hideHistorySection = false,
  portalMode = false,
}: RequirementPanelProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const [markingPaid, setMarkingPaid] = useState(false)
  const [notes, setNotes] = useState(client.notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [renewingPackage, setRenewingPackage] = useState(false)
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

  async function handleMarkPaid2() {
    setMarkingPaid(true)
    const supabase = createClient()
    await supabase
      .from('billing_cycles')
      .update({ payment_status_2: 'paid', payment_date_2: new Date().toISOString() })
      .eq('id', cycle.id)
    setMarkingPaid(false)
    router.refresh()
  }

  const isBiweekly = client.billing_period === 'biweekly'

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

  // Section header: "Abril 2026" basado en el mes con más días del ciclo.
  const { year: cycleYear, month: cycleMonthIdx } = dominantCycleMonth(
    cycle.period_start,
    cycle.period_end,
  )
  const cycleMonthLabel = `${MONTHS_FULL[cycleMonthIdx]} ${cycleYear}`

  // Plan "Contenido" — pool unificado compartido entre tippables
  const poolUsage = unifiedPoolUsage(cycle.limits_snapshot_json, totals)
  const isUnifiedPool = poolUsage !== null
  const isContentExhausted = isUnifiedPool && poolUsage !== null && poolUsage.used >= poolUsage.limit

  async function handleRenewContentPackage() {
    if (!confirm('¿Confirmar nuevo paquete de 10 contenidos?')) return
    setRenewingPackage(true)
    const res = await renewContentPackage(cycle.id, client.id, cycle.plan_id_snapshot ?? '')
    setRenewingPackage(false)
    if (res.error) {
      alert(`Error: ${res.error}`)
      return
    }
    router.refresh()
  }

  // Ajustar límites: en plan unificado, cada tippable puede recibir hasta `remainingPool + totals[t]`
  const effectiveLimitsMap = isUnifiedPool
    ? applyUnifiedPool(limits, cycle.limits_snapshot_json, totals)
    : limits

  // Active content types (limit > 0)
  // En plan unificado, todos los tipos tippables se consideran activos mientras quede pool.
  const activeTypes = isUnifiedPool
    ? CONTENT_TYPES.filter((t) =>
        TIPPABLE_CONTENT_TYPES.includes(t)
          ? (poolUsage!.limit - poolUsage!.used) > 0 || (totals[t] ?? 0) > 0
          : effectiveLimitsMap[t] > 0
      )
    : CONTENT_TYPES.filter((t) => limits[t] > 0)
  const pipelineTypes = activeTypes.filter((t) => !COUNTER_ONLY_TYPES.includes(t))
  const simpleTypes = activeTypes.filter((t) => SIMPLE_TYPES.includes(t))
  const hasMatriz = activeTypes.includes('matriz_contenido') && limits.matriz_contenido > 0

  // Weekly breakdown
  const daysSinceStart = Math.floor(
    (new Date().getTime() - new Date(cycle.period_start).getTime()) / (1000 * 60 * 60 * 24)
  )
  const currentWeek = Math.min(Math.floor(daysSinceStart / 7), 3)

  // Pipeline de distribución semanal (4 pasos):
  //   1. default (plan o override del cliente)
  //   2. augment (rellena tipos con ceil(limit/4)) — usa los límites ya con content override
  //   3. applyOverride (override semanal explícito por ciclo)
  //   4. addRollover (reparte el rollover equitativamente)
  const contentOverrideJson = cycle.content_limits_override_json as Partial<Record<ContentType, number>> | null
  const limitsForDist: Record<ContentType, number> = contentOverrideJson
    ? { ...limits, ...contentOverrideJson }
    : limits
  const baseDist = resolveDistribution(
    (client as { weekly_distribution_json?: import('@/types/db').WeeklyDistribution | null }).weekly_distribution_json,
    client.plan?.default_weekly_distribution_json,
  ) ?? {}
  const augmentedDist = augmentDistribution(baseDist, pipelineTypes, limitsForDist)
  const overriddenDist = applyOverride(
    augmentedDist,
    (cycle as { weekly_distribution_override_json?: import('@/types/db').WeeklyDistribution | null }).weekly_distribution_override_json,
  )
  const effectiveDist = addRollover(overriddenDist, rolloverToContentType(cycle.rollover_from_previous_json))
  const weekBreakdown = computeWeeklyBreakdownWithCascade(requirements, effectiveDist, currentWeek)

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
              <h1 className="text-3xl font-extrabold tracking-tight text-fm-on-surface">
                {client.name}
              </h1>
              <span className="px-3 py-1 bg-fm-secondary-fixed/50 text-fm-secondary text-xs font-extrabold rounded-full uppercase tracking-wider">
                Plan {client.plan.name}
              </span>
              <span className="px-3 py-1 bg-fm-secondary-fixed text-fm-on-secondary-container text-xs font-extrabold rounded-full uppercase tracking-wider">
                {STATUS_LABELS[client.status] ?? client.status}
              </span>
            </div>

            {/* Cycle date + payment */}
            <p className="text-fm-on-surface-variant text-sm flex flex-wrap items-center justify-center md:justify-start gap-1.5">
              {isUnifiedPool ? (
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-base">inventory_2</span>
                  Paquete activo desde {formatDateShort(cycle.period_start)}
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-base">calendar_today</span>
                  Ciclo: {formatDateShort(cycle.period_start)} – {formatDateShort(cycle.period_end)}
                  &nbsp;·&nbsp; Pago: día {client.billing_day}{isBiweekly && client.billing_day_2 ? ` y ${client.billing_day_2}` : ''}
                </span>
              )}
              {/* 1er pago (o único en monthly) */}
              {cycle.payment_status === 'paid' ? (
                <span className="px-2 py-0.5 bg-fm-primary/10 text-fm-primary text-[10px] font-extrabold rounded-full border border-fm-primary/20">
                  ✓ {isBiweekly ? '1er pago' : 'Pagado'}
                </span>
              ) : isAdmin ? (
                <button
                  onClick={handleMarkPaid}
                  disabled={markingPaid}
                  className="px-2 py-0.5 bg-fm-error/10 text-fm-error text-[10px] font-extrabold rounded-full border border-fm-error/20 hover:bg-fm-error/20 transition-colors"
                >
                  {markingPaid ? '...' : isBiweekly ? 'Marcar 1er pago' : 'Marcar pagado'}
                </button>
              ) : (
                <span className="px-2 py-0.5 bg-fm-error/10 text-fm-error text-[10px] font-extrabold rounded-full border border-fm-error/20">
                  {isBiweekly ? '1er pago pendiente' : 'Sin pago'}
                </span>
              )}
              {/* 2do pago — solo biweekly */}
              {isBiweekly && (
                cycle.payment_status_2 === 'paid' ? (
                  <span className="px-2 py-0.5 bg-fm-primary/10 text-fm-primary text-[10px] font-extrabold rounded-full border border-fm-primary/20">
                    ✓ 2do pago
                  </span>
                ) : isAdmin ? (
                  <button
                    onClick={handleMarkPaid2}
                    disabled={markingPaid}
                    className="px-2 py-0.5 bg-fm-error/10 text-fm-error text-[10px] font-extrabold rounded-full border border-fm-error/20 hover:bg-fm-error/20 transition-colors"
                  >
                    {markingPaid ? '...' : 'Marcar 2do pago'}
                  </button>
                ) : (
                  <span className="px-2 py-0.5 bg-fm-error/10 text-fm-error text-[10px] font-extrabold rounded-full border border-fm-error/20">
                    2do pago pendiente
                  </span>
                )
              )}
            </p>

            {/* Social handles */}
            {(client.ig_handle || client.fb_handle || client.tiktok_handle ||
              client.yt_handle || client.linkedin_handle || client.website_url || client.other_contact) && (
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 pt-1">
                {client.ig_handle && (
                  <SocialChip
                    network="instagram"
                    handle={client.ig_handle}
                    icon="photo_camera"
                    display={`@${client.ig_handle.replace('@', '')}`}
                  />
                )}
                {client.fb_handle && (
                  <SocialChip
                    network="facebook"
                    handle={client.fb_handle}
                    icon="thumb_up"
                    display={client.fb_handle}
                  />
                )}
                {client.tiktok_handle && (
                  <SocialChip
                    network="tiktok"
                    handle={client.tiktok_handle}
                    icon="music_note"
                    display={`@${client.tiktok_handle.replace('@', '')}`}
                  />
                )}
                {client.yt_handle && (
                  <SocialChip
                    network="youtube"
                    handle={client.yt_handle}
                    icon="play_circle"
                    display={client.yt_handle}
                  />
                )}
                {client.linkedin_handle && (
                  <SocialChip
                    network="linkedin"
                    handle={client.linkedin_handle}
                    icon="work"
                    display={client.linkedin_handle}
                  />
                )}
                {client.website_url && (
                  <a
                    href={client.website_url.startsWith('http') ? client.website_url : `https://${client.website_url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1 bg-fm-surface-container-low text-fm-on-surface-variant text-[11px] font-bold rounded-full border border-fm-outline-variant/20 hover:bg-fm-primary/10 transition-colors"
                  >
                    <span className="material-symbols-outlined text-sm">language</span>
                    {client.website_url.replace(/^https?:\/\//, '')}
                  </a>
                )}
                {client.other_contact && (
                  <span className="flex items-center gap-1.5 px-3 py-1 bg-fm-surface-container-low text-fm-on-surface-variant text-[11px] font-bold rounded-full border border-fm-outline-variant/20">
                    <span className="material-symbols-outlined text-sm">alternate_email</span>
                    {client.other_contact}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons — ocultos en portal del cliente */}
        {!portalMode && (
          <div className="flex items-center gap-3 w-full md:w-auto flex-shrink-0">
            <Link
              href={`/clients/${client.id}/report`}
              className="flex-1 md:flex-none px-5 py-2.5 border-2 border-fm-on-surface-variant text-fm-on-surface-variant font-bold rounded-full hover:bg-fm-on-surface-variant/5 transition-all active:scale-95 text-sm text-center flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-base">summarize</span>
              Ver reporte
            </Link>
            <Link
              href={`/clients/${client.id}/edit`}
              className="flex-1 md:flex-none px-5 py-2.5 border-2 border-fm-primary text-fm-primary font-bold rounded-full hover:bg-fm-primary/5 transition-all active:scale-95 text-sm text-center"
            >
              Editar cliente
            </Link>
            {canCreate && (
              <button
                onClick={() => !isOverdue && !isContentExhausted && setModalOpen(true)}
                disabled={isOverdue || isContentExhausted}
                className={`flex-1 md:flex-none px-5 py-2.5 text-white font-bold rounded-full flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95 text-sm ${(isOverdue || isContentExhausted) ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-110'}`}
                style={{ background: (isOverdue || isContentExhausted) ? '#b31b25' : 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)', boxShadow: '0 4px 15px rgba(0,103,92,0.25)' }}
              >
                <span className="material-symbols-outlined text-base">{(isOverdue || isContentExhausted) ? 'block' : 'add'}</span>
                {isOverdue ? 'Cuenta vencida' : isContentExhausted ? 'Paquete agotado' : 'Registrar requerimiento'}
              </button>
            )}
          </div>
        )}
      </section>

      {/* ── Overdue warning ── */}
      {isOverdue && (
        <div className="bg-fm-error/5 border border-fm-error/20 rounded-2xl px-5 py-4 flex items-center gap-3">
          <span className="material-symbols-outlined text-fm-error text-xl flex-shrink-0">warning</span>
          <div>
            <p className="text-sm font-semibold text-fm-error">Cuenta vencida — registro de requerimientos bloqueado</p>
            <p className="text-xs text-fm-error/80 mt-0.5">
              El ciclo venció y el pago está pendiente.
              {isAdmin ? ' Marca el pago como recibido para desbloquear.' : ' Contacta al administrador para regularizar el pago.'}
            </p>
          </div>
        </div>
      )}

      {/* ── Package exhausted banner ── */}
      {isContentExhausted && (
        <div className="bg-fm-primary/5 border border-fm-primary/20 rounded-2xl px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-fm-primary text-xl flex-shrink-0">task_alt</span>
            <div>
              <p className="text-sm font-semibold text-fm-primary">Paquete de 10 contenidos completado</p>
              <p className="text-xs text-fm-on-surface-variant mt-0.5">
                Se han registrado los {poolUsage!.limit} contenidos incluidos en el paquete.
                {canCreate ? ' ¿El cliente desea contratar otro paquete?' : ''}
              </p>
            </div>
          </div>
          {canCreate && (
            <button
              onClick={handleRenewContentPackage}
              disabled={renewingPackage}
              className="flex items-center gap-2 px-5 py-2.5 text-white font-bold rounded-full text-sm disabled:opacity-60 flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)', boxShadow: '0 4px 15px rgba(0,103,92,0.25)' }}
            >
              <span className="material-symbols-outlined text-base">add_shopping_cart</span>
              {renewingPackage ? 'Creando…' : 'Contratar nuevo paquete'}
            </button>
          )}
        </div>
      )}

      {/* ── Requerimientos del ciclo ── */}
      <section className="space-y-5">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight text-fm-on-surface">
            Requerimientos del ciclo actual
          </h2>
          <p className="text-fm-on-surface-variant font-medium text-sm mt-1">
            {cycleMonthLabel}
            {!isUnifiedPool && daysLeft !== null && (
              <>
                {' '}·{' '}
                <span style={{ color: daysLeft < 0 ? '#b31b25' : daysLeft <= 3 ? '#b31b25' : '#00675c' }}>
                  {daysLeft < 0 ? 'Vencido' : daysLeft === 0 ? 'Vence hoy' : `${daysLeft} días restantes`}
                </span>
              </>
            )}
            {isContentExhausted && (
              <span className="font-bold text-fm-error ml-2">· Paquete agotado</span>
            )}
          </p>
        </div>

        {/* Unified pool bar — solo plan "Contenido" */}
        {isUnifiedPool && poolUsage && (() => {
          const { used, limit } = poolUsage
          const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
          const color = barColor(pct)
          const available = Math.max(0, limit - used)
          return (
            <div className="glass-panel p-6 rounded-[2rem] space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-fm-primary-container/30 rounded-xl w-fit">
                    <span className="material-symbols-outlined text-fm-primary text-xl">collections</span>
                  </div>
                  <div>
                    <p className="text-fm-on-surface-variant text-[11px] font-extrabold tracking-widest uppercase">
                      Contenidos del ciclo (pool unificado)
                    </p>
                    <p className="text-2xl font-black text-fm-on-surface mt-0.5">
                      {used} <span className="text-base font-medium text-fm-outline">/ {limit}</span>
                    </p>
                  </div>
                </div>
                <p className="text-xs font-bold" style={{ color: available === 0 ? '#b31b25' : '#00675c' }}>
                  {available} disponibles
                </p>
              </div>
              <div className="w-full bg-fm-surface-container dark:bg-fm-surface-container-high rounded-full h-2 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
              <div className="flex flex-wrap gap-3 pt-1">
                {TIPPABLE_CONTENT_TYPES.map((t) => {
                  const n = totals[t] ?? 0
                  if (n === 0) return null
                  return (
                    <span key={t} className="flex items-center gap-1.5 text-[11px] font-bold text-fm-on-surface-variant">
                      <span className="material-symbols-outlined text-sm text-fm-primary">
                        {CONTENT_ICONS[t]}
                      </span>
                      {CONTENT_TYPE_LABELS[t]}: {n}
                    </span>
                  )
                })}
                {TIPPABLE_CONTENT_TYPES.every((t) => (totals[t] ?? 0) === 0) && (
                  <span className="text-[11px] text-fm-outline-variant">Sin registros aún — el operador elige el tipo al registrar.</span>
                )}
              </div>
            </div>
          )
        })()}

        {/* Requirement cards (tippables ocultos en plan unificado — solo counter-only y specials) */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {activeTypes.filter((t) => !isUnifiedPool || !TIPPABLE_CONTENT_TYPES.includes(t)).map((type) => {
            const historiaBd = type === 'historia' ? historiaBreakdown(requirements) : null
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

            const availableColor = '#595c5e'
            const color = barColor(pct)

            return (
              <div
                key={type}
                className="glass-panel p-5 rounded-[1.5rem] hover:translate-y-[-3px] transition-transform duration-300 flex flex-col gap-3"
              >
                {/* Icon */}
                <div className="content-chip p-2 rounded-xl w-fit">
                  <span className="content-icon material-symbols-outlined text-xl">
                    {CONTENT_ICONS[type]}
                  </span>
                </div>

                {/* Label + count */}
                <div>
                  <p className="text-fm-on-surface-variant text-[11px] font-extrabold tracking-widest uppercase">
                    {CONTENT_TYPE_LABELS[type]}
                  </p>
                  <p className="text-2xl font-black text-fm-on-surface mt-0.5">
                    {consumed}{' '}
                    <span className="text-base font-medium text-fm-outline">
                      / {baseLimit}
                      {rollover > 0 && (
                        <span className="text-[10px] text-fm-secondary ml-1">(+{rollover})</span>
                      )}
                      {extraSold > 0 && (
                        <span className="text-[10px] text-fm-tertiary ml-1">(+{extraSold})</span>
                      )}
                    </span>
                  </p>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-fm-surface-container dark:bg-fm-surface-container-high rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${pct}%`, backgroundColor: color }}
                  />
                </div>

                {/* Available */}
                <p className="text-[11px] font-bold" style={{ color: availableColor }}>
                  {available} disponibles
                </p>

                {/* Historia breakdown: propias + derivadas */}
                {historiaBd && historiaBd.derivadas > 0 && (
                  <p className="text-[10px] text-fm-on-surface-variant leading-tight">
                    <span className="font-bold">{historiaBd.propias}</span> propias
                    {' + '}
                    <span className="font-bold text-purple-600">{historiaBd.derivadas}</span> derivadas
                  </p>
                )}
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
              <p className="text-[11px] font-extrabold text-fm-outline-variant uppercase tracking-widest shrink-0">
                Cambios del ciclo
              </p>

              <div className="flex items-center gap-3">
                {/* Short progress bar */}
                <div className="w-32 bg-fm-surface-container dark:bg-fm-surface-container-high rounded-full h-1.5 overflow-hidden">
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
                  <span className="w-2 h-2 rounded-full bg-fm-surface-container-high" />
                  <span className="text-[11px] text-fm-on-surface-variant">
                    Plan: <strong className="text-fm-on-surface">{planBase}</strong>
                  </span>
                </div>
                {pkgTotal > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-fm-primary-container" />
                    <span className="text-[11px] text-fm-on-surface-variant">
                      Comprados: <strong className="text-fm-primary">+{pkgTotal}</strong>
                      {packages.length > 0 && (
                        <span className="ml-1 text-fm-outline-variant">
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
      {!isUnifiedPool && <section className="space-y-5">
        <h3 className="text-xl font-extrabold tracking-tight text-fm-on-surface">
          Desglose semanal
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {weekBreakdown.map((week) => {
                const weekLabel = `Semana ${week.label.slice(1)}`
                const isFuture = !week.isCurrent && ['S1','S2','S3','S4'].indexOf(week.label) > currentWeek
                const budgetTypes = pipelineTypes.filter(t => (week.budget[t] ?? 0) > 0)
                const hasActivity = pipelineTypes.some(t => (week.counts[t] ?? 0) > 0 || (week.overflow[t] ?? 0) > 0)
                const weekIdx = (['S1','S2','S3','S4'].indexOf(week.label) + 1) as 1 | 2 | 3 | 4
                const unlocked = isWeekUnlocked(weekIdx, cycle, client)

                return (
                  <div
                    key={week.label}
                    className="glass-panel p-5 rounded-[1.5rem] relative"
                    style={week.isCurrent ? { background: 'rgba(0,103,92,0.05)', border: '2px solid rgba(0,103,92,0.3)' } : {}}
                  >
                    <div className="flex justify-between items-start mb-4">
                      <p className="text-[11px] font-extrabold uppercase tracking-widest" style={{ color: week.isCurrent ? '#00675c' : '#595c5e' }}>
                        {weekLabel}{week.isCurrent && ' · Actual'}
                      </p>
                      {week.isCurrent && <span className="flex h-2 w-2 rounded-full bg-fm-primary animate-pulse flex-shrink-0" />}
                    </div>

                    {!unlocked && (
                      <div className="absolute inset-0 bg-fm-surface-container-lowest/85 backdrop-blur-[1px] rounded-[1.5rem] flex flex-col items-center justify-center gap-2 z-10">
                        <span className="material-symbols-outlined text-2xl text-fm-error">lock</span>
                        <p className="text-xs font-bold text-fm-error text-center px-4">
                          {weekIdx <= 2 ? '1ra quincena' : '2da quincena'}
                        </p>
                        <p className="text-[10px] text-fm-on-surface-variant text-center px-4">
                          Bloqueada — pago pendiente
                        </p>
                      </div>
                    )}

                    {budgetTypes.length === 0 && !hasActivity ? (
                      <p className="text-xs text-fm-outline-variant">{isFuture ? 'Pendiente' : 'Sin actividad'}</p>
                    ) : (
                      <div className="space-y-3">
                        {(budgetTypes.length > 0 ? budgetTypes : pipelineTypes.filter(t => (week.counts[t] ?? 0) > 0)).map((type) => {
                          const consumed = week.counts[type] ?? 0
                          const budget = week.budget[type] ?? 0
                          const extra = week.overflow[type] ?? 0
                          const pct = budget > 0 ? Math.min(100, Math.round((consumed / budget) * 100)) : 0
                          const isComplete = budget > 0 && consumed >= budget
                          const weekBarColor = isComplete ? '#00675c' : isFuture ? '#e5e9eb' : '#f59e0b'
                          return (
                            <div key={type}>
                              <div className="flex justify-between items-center mb-1">
                                <span className="flex items-center gap-1 text-[11px] text-fm-on-surface-variant font-medium">
                                  <span className="material-symbols-outlined text-sm">{CONTENT_ICONS[type]}</span>
                                  {CONTENT_TYPE_LABELS[type]}
                                </span>
                                <div className="flex items-center gap-1">
                                  <span className="text-[11px] font-bold text-fm-on-surface">
                                    {consumed}<span className="font-normal text-fm-outline-variant">/{budget}</span>
                                  </span>
                                  {extra > 0 && (
                                    <span className="text-[9px] font-bold px-1 py-0.5 rounded-full bg-fm-error/10 text-fm-error">
                                      +{extra}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {budget > 0 && (
                                <div className="w-full bg-fm-surface-container dark:bg-fm-surface-container-high rounded-full h-1.5 overflow-hidden">
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
          }
        </div>
      </section>}

      {/* ── Matriz, producciones y reuniones del mes ── */}
      {(simpleTypes.length > 0 || hasMatriz) && (
        <section className="space-y-5">
          <h3 className="text-xl font-extrabold tracking-tight text-fm-on-surface">
            {hasMatriz ? 'Matriz, producciones y reuniones del mes' : 'Producciones y reuniones del mes'}
          </h3>
          {/* Counter */}
          <div className="flex gap-4 flex-wrap">
            {hasMatriz && (
              <div className="flex items-center gap-2 px-4 py-2 glass-panel rounded-2xl">
                <span className="material-symbols-outlined text-fm-primary text-base">
                  {CONTENT_ICONS.matriz_contenido}
                </span>
                <span className="text-sm font-bold text-fm-on-surface">
                  {totals.matriz_contenido ?? 0} / {limits.matriz_contenido}{' '}
                  {(totals.matriz_contenido ?? 0) === 1 ? 'matriz' : 'matrices'}
                </span>
              </div>
            )}
            {simpleTypes.map((type) => {
              const count = requirements.filter(
                (r) => r.content_type === type && !r.voided && !r.carried_over
              ).length
              return (
                <div key={type} className="flex items-center gap-2 px-4 py-2 glass-panel rounded-2xl">
                  <span className="material-symbols-outlined text-fm-primary text-base">
                    {CONTENT_ICONS[type]}
                  </span>
                  <span className="text-sm font-bold text-fm-on-surface">
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
                    <p className="text-sm text-fm-on-surface-variant">Sin registros este ciclo.</p>
                  </div>
                )
              }

              return (
                <div className="divide-y divide-fm-surface-container-high/60">
                  {simpleEntries.map((r) => {
                    const type = r.content_type as ContentType
                    const date = new Date(r.registered_at)
                    const dateStr = `${date.getDate()} ${['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'][date.getMonth()]} ${date.getFullYear()}`
                    return (
                      <div key={r.id} className="px-6 py-4 flex items-start gap-4">
                        <div className="p-2 bg-fm-primary-container/30 rounded-xl flex-shrink-0 mt-0.5">
                          <span className="material-symbols-outlined text-fm-primary text-base">
                            {CONTENT_ICONS[type]}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-fm-on-surface">
                            {CONTENT_TYPE_LABELS[type]} — {dateStr}
                          </p>
                          {r.notes && (
                            <p className="text-xs text-fm-on-surface-variant mt-0.5">{r.notes}</p>
                          )}
                          {r.title && (
                            <p className="text-xs text-fm-outline mt-0.5 italic">{r.title}</p>
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

      {/* ── History + Notes grid (omitido cuando hideHistorySection=true) ── */}
      {!hideHistorySection && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Cycle history — col-span-7 */}
          <div className="lg:col-span-7 space-y-4">
            <h3 className="text-xl font-extrabold tracking-tight text-fm-on-surface">
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
            <h3 className="text-xl font-extrabold tracking-tight text-fm-on-surface">
              Notas internas
            </h3>
            <div className="glass-panel p-6 rounded-[2rem] flex flex-col" style={{ minHeight: '340px' }}>
              <textarea
                className="flex-1 w-full bg-transparent border border-fm-outline-variant/30 rounded-2xl p-4 text-sm text-fm-on-surface placeholder:text-fm-outline/50 resize-none outline-none transition-all focus:border-fm-primary/50 focus:ring-2 focus:ring-fm-primary-container/40"
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
      )}

      {/* Requirement modal */}
      <RequirementModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        client={client}
        cycle={cycle}
        totals={totals}
        limits={effectiveLimitsMap}
        isAdmin={isAdmin}
        canAssign={canAssign}
        assignableUsers={assignableUsers}
      />
    </>
  )
}
