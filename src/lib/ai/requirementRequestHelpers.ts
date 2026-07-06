import { createAdminClient } from '@/lib/supabase/admin'
import { createRequirementRequestCore } from '@/app/actions/requirementRequests'
import { ALLOWED_REQUEST_TYPES } from '@/lib/domain/requirementRequest'
import {
  effectiveLimits,
  applyContentLimitsWithOverride,
  applyUnifiedPool,
  unifiedPoolUsage,
  TIPPABLE_CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
} from '@/lib/domain/plans'
import { computeTotals, isWeekUnlocked, weekIndexInCycle, maxWeeksForPeriod } from '@/lib/domain/requirement'
import { getAvailableContentCredits } from '@/lib/domain/credits'
import type { BillingCycle, Client, ContentType, PlanLimits, Requirement } from '@/types/db'

const FM_BOT_USER_ID = '00000000-0000-0000-0000-000000000b07'

export interface RequestEligibilityResult {
  can_create: boolean
  blockers: string[]
  cycle: null | {
    id: string
    period_start: string
    period_end: string
    days_remaining: number | null
    payment_status: 'paid' | 'unpaid'
    no_expira: boolean
  }
  /**
   * Presente SOLO en planes con pool unificado (paquetes on-demand): el cliente
   * tiene `limit` contenidos de CUALQUIER tipo tippable (estático/video/reel/short),
   * de los cuales le quedan `available`. En estos planes el bot debe reportar la
   * bolsa unificada ("te quedan N contenidos de cualquier tipo"), NO el desglose
   * por tipo (que aquí repite el mismo `available` del pool en cada tippable).
   */
  unified_pool: { used: number; limit: number; available: number } | null
  available_content_types: Array<{
    type: ContentType
    label: string
    used: number
    limit: number
    available: number
    allows_extra_story: boolean
  }>
}

const STORY_ELIGIBLE: ContentType[] = ['estatico', 'video_corto', 'reel', 'short']

/** Suma créditos extra de contenido al `available` de cada tipo (pura). */
export function applyExtraCreditsToAvailability(
  types: RequestEligibilityResult['available_content_types'],
  credits: Partial<Record<ContentType, number>>,
): RequestEligibilityResult['available_content_types'] {
  return types.map((t) => ({ ...t, available: t.available + (credits[t.type] ?? 0) }))
}

/**
 * Computa elegibilidad y disponibilidad del cliente para crear solicitudes
 * de contenido. Espejo de la lógica del portal pero sin sesión browser.
 */
export async function checkRequestEligibilityForClient(clientId: string): Promise<RequestEligibilityResult> {
  const admin = createAdminClient()
  const blockers: string[] = []

  const { data: client } = await admin
    .from('clients')
    .select('id, status, billing_period')
    .eq('id', clientId)
    .maybeSingle()
  if (!client) {
    return {
      can_create: false,
      blockers: ['Cliente no encontrado.'],
      cycle: null,
      unified_pool: null,
      available_content_types: [],
    }
  }
  if (client.status === 'inactive_payment') {
    blockers.push('La cuenta está suspendida por falta de pago.')
  }
  if (client.status === 'inactive_manual') {
    blockers.push('La cuenta está desactivada por la agencia.')
  }

  const { data: cycle } = await admin
    .from('billing_cycles')
    .select('id, period_start, period_end, payment_status, payment_status_2, grace_period_until, billing_period, limits_snapshot_json, rollover_from_previous_json, content_limits_override_json, no_expira')
    .eq('client_id', clientId)
    .eq('status', 'current')
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!cycle) {
    blockers.push('No hay ciclo de facturación activo.')
    return { can_create: false, blockers, cycle: null, unified_pool: null, available_content_types: [] }
  }
  const cycleRow = cycle as unknown as {
    id: string
    period_start: string
    period_end: string
    payment_status: 'paid' | 'unpaid'
    payment_status_2: 'paid' | 'unpaid'
    grace_period_until: string | null
    billing_period: Client['billing_period']
    limits_snapshot_json: PlanLimits
    rollover_from_previous_json: Partial<PlanLimits> | null
    content_limits_override_json: Partial<Record<ContentType, number>> | null
    no_expira: boolean
  }

  // Días restantes (SV TZ).
  let daysRemaining: number | null = null
  if (!cycleRow.no_expira && cycleRow.period_end) {
    const end = new Date(cycleRow.period_end)
    const today = new Date()
    daysRemaining = Math.max(0, Math.ceil((end.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)))
  }

  // Calcular límites + consumo.
  const baseLimits = effectiveLimits(cycleRow.limits_snapshot_json, cycleRow.rollover_from_previous_json)
  const limitsWithOverride = applyContentLimitsWithOverride(baseLimits, cycleRow.content_limits_override_json ?? null)

  const { data: reqs } = await admin
    .from('requirements')
    .select('id, content_type, includes_story, voided, carried_over, consumption_overrides_json')
    .eq('billing_cycle_id', cycleRow.id)
    .eq('approval_status', 'approved')
    .limit(2000)
  const totals = computeTotals((reqs ?? []) as Requirement[])

  // Pool unificado (paquetes on-demand "N contenidos de cualquier tipo"):
  // redistribuye los tippables sobre la bolsa común. Sin esto, en estos planes
  // los tippables valen 0 en el snapshot y el bot cree que no hay disponibilidad.
  const limits = applyUnifiedPool(limitsWithOverride, cycleRow.limits_snapshot_json, totals)
  const poolUsage = unifiedPoolUsage(cycleRow.limits_snapshot_json, totals)

  // Gate de semana/pago (mismo criterio que el trigger SQL y el core de creación):
  // si la semana actual del ciclo no está pagada y no hay gracia vigente, bloquear.
  const cycleBillingPeriod = cycleRow.billing_period ?? client.billing_period
  const week = weekIndexInCycle(new Date(), cycleRow.period_start, maxWeeksForPeriod(cycleBillingPeriod))
  const weekUnlocked = isWeekUnlocked(
    week,
    cycleRow as unknown as BillingCycle,
    { billing_period: cycleBillingPeriod },
  )
  if (!weekUnlocked) {
    blockers.push('La semana actual del ciclo requiere el pago correspondiente antes de solicitar contenido nuevo.')
  }

  const available_content_types: RequestEligibilityResult['available_content_types'] = ALLOWED_REQUEST_TYPES.map(
    (t) => ({
      type: t,
      label: CONTENT_TYPE_LABELS[t] ?? t,
      used: totals[t] ?? 0,
      limit: limits[t] ?? 0,
      available: Math.max(0, (limits[t] ?? 0) - (totals[t] ?? 0)),
      allows_extra_story: STORY_ELIGIBLE.includes(t),
    }),
  )

  const extraCredits = await getAvailableContentCredits(admin, clientId)
  const merged = applyExtraCreditsToAvailability(available_content_types, extraCredits)

  // La bolsa unificada incluye también los créditos extra de tipos tippables,
  // para que lo que reporta el bot coincida con lo que create_requirement_request
  // realmente permitirá crear (el gate por-tipo sí suma esos créditos).
  const tippableCredits = TIPPABLE_CONTENT_TYPES.reduce((s, t) => s + (extraCredits[t] ?? 0), 0)
  const unified_pool = poolUsage
    ? {
        used: poolUsage.used,
        limit: poolUsage.limit,
        available: Math.max(0, poolUsage.limit - poolUsage.used) + tippableCredits,
      }
    : null

  return {
    can_create: blockers.length === 0,
    blockers,
    cycle: {
      id: cycleRow.id,
      period_start: cycleRow.period_start,
      period_end: cycleRow.period_end,
      days_remaining: daysRemaining,
      payment_status: cycleRow.payment_status,
      no_expira: cycleRow.no_expira,
    },
    unified_pool,
    available_content_types: merged,
  }
}

/**
 * Crea una solicitud de requerimiento en nombre del cliente, como el FM Bot.
 * Reutiliza el core (mismas validaciones que el portal).
 */
export async function createRequirementFromBot(args: {
  clientId: string
  contentType: ContentType
  title: string
  description?: string | null
  desiredAt: string
  includesStory?: boolean
}): Promise<{ ok: true; id: string } | { error: string }> {
  return createRequirementRequestCore({
    clientId: args.clientId,
    requestedByUserId: FM_BOT_USER_ID,
    contentType: args.contentType,
    title: args.title,
    description: args.description ?? null,
    desiredAt: args.desiredAt,
    includesStory: args.includesStory,
    requestedVia: 'whatsapp_bot',
  })
}
