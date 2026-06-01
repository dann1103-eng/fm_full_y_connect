'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { nextCycleDates, firstCycleDates } from '@/lib/domain/cycles'
import { today as todayString, addDaysString } from '@/lib/domain/dates'
import { CONTENT_TYPES, CONTENT_TO_PLAN_KEY, effectiveLimits } from '@/lib/domain/plans'
import { computeTotals } from '@/lib/domain/requirement'
import { migrateOpenPipelineItems, PIPELINE_CONTENT_TYPES } from '@/lib/domain/pipeline'
import { cleanupCycleStorage } from '@/lib/supabase/cleanup-cycle-storage'
import { assertNotImpersonating } from './impersonation'
import { requireAdminOrSupervisor } from '@/lib/auth/require-user'
import type {
  BillingPeriod, CambiosPackage, ContentType, ExtraContentItem, PlanLimits, PaymentStatus,
} from '@/types/db'

interface RenewArgs {
  cycleId: string
  clientId: string
  planId: string
  billingPeriod: BillingPeriod
  rolloverChecked: Partial<Record<ContentType, boolean>>
  cambiosPackages: CambiosPackage[]
  extraContent: ExtraContentItem[]
  withChanges: boolean
  /** Si true, archiva el ciclo actual y promueve el nuevo a 'current' inmediatamente.
   *  Por defecto false: el nuevo ciclo se crea en 'scheduled' y el cron lo promueve
   *  cuando termina el ciclo actual. */
  immediate?: boolean
}

export async function renewCycle(args: RenewArgs) {
  await requireAdminOrSupervisor()
  const supabase = await createClient()

  const [{ data: cycleRow }, { data: clientRow }, { data: planRow }, { data: reqs }] = await Promise.all([
    supabase.from('billing_cycles').select('*').eq('id', args.cycleId).single(),
    supabase.from('clients').select('*, plan:plans!clients_current_plan_id_fkey(*)').eq('id', args.clientId).single(),
    supabase.from('plans').select('*').eq('id', args.planId).single(),
    supabase.from('requirements').select('*').eq('billing_cycle_id', args.cycleId),
  ])

  if (!cycleRow || !clientRow || !planRow) {
    return { error: 'No se pudo cargar el ciclo actual.' }
  }

  const totals = computeTotals(reqs ?? [])
  const limits = effectiveLimits(cycleRow.limits_snapshot_json, cycleRow.rollover_from_previous_json)

  const planLimits: PlanLimits = planRow.unified_content_limit != null
    ? { ...planRow.limits_json, unified_content_limit: planRow.unified_content_limit }
    : planRow.limits_json

  const rolloverJson: Partial<PlanLimits> = {}
  let hasRollover = false
  for (const type of CONTENT_TYPES) {
    if (args.rolloverChecked[type]) {
      const unused = limits[type] - totals[type]
      if (unused > 0) {
        rolloverJson[CONTENT_TO_PLAN_KEY[type]] = unused
        hasRollover = true
      }
    }
  }

  // Decidir el modo de renovación.
  //
  // El modo "programado" (scheduled) solo tiene sentido cuando el ciclo que se
  // renueva sigue VIGENTE (status='current' y aún no vence): el cron promueve
  // scheduled→current al expirar un 'current'. Pero si el ciclo ya venció o está
  // en pending_renewal/archived (el caso típico de un moroso en /renovaciones),
  // NO existe ningún 'current' que vaya a expirar, así que el scheduled jamás se
  // activaría y el cliente quedaría sin ciclo. En ese caso renovamos YA (inmediato).
  const todayStr = todayString()
  const cycleExpired = (cycleRow.period_end as string) < todayStr
  const cycleNotCurrent = cycleRow.status !== 'current'
  const immediate = args.immediate === true || cycleExpired || cycleNotCurrent

  const rawNext = nextCycleDates(cycleRow.period_end, { billingPeriod: args.billingPeriod })
  // En renovación inmediata de un ciclo vencido hace días, el "siguiente" calculado
  // quedaría en el pasado. Anclar el inicio a hoy para no crear un ciclo ya expirado.
  const anchorToToday = immediate && (rawNext.periodStart as string) < todayStr
  const { periodStart, periodEnd } = anchorToToday
    ? firstCycleDates(todayStr, { billingPeriod: args.billingPeriod })
    : rawNext

  // Si NO es inmediata: solo crear/actualizar scheduled, sin tocar el current ni el cliente.
  // El cron promoverá scheduled→current cuando period_end del current expire, y en ese
  // momento actualizará clients.current_plan_id si el plan cambió.
  if (!immediate) {
    // ¿Ya hay un scheduled? Lo actualizamos. Si no, creamos uno.
    const { data: existingScheduled } = await supabase
      .from('billing_cycles')
      .select('id')
      .eq('client_id', args.clientId)
      .eq('status', 'scheduled')
      .maybeSingle()

    const scheduledPayload = {
      client_id: args.clientId,
      plan_id_snapshot: args.planId,
      limits_snapshot_json: planLimits,
      rollover_from_previous_json: hasRollover ? rolloverJson : null,
      period_start: periodStart,
      period_end: periodEnd,
      status: 'scheduled' as const,
      payment_status: 'unpaid' as const,
      billing_period: planRow.billing_period ?? 'monthly',
      no_expira: planRow.no_expira ?? false,
      cambios_budget:
        planRow.cambios_included +
        (args.withChanges ? args.cambiosPackages.reduce((s, p) => s + p.qty, 0) : 0),
      cambios_packages_json: args.withChanges ? args.cambiosPackages : [],
      extra_content_json: args.withChanges ? args.extraContent : [],
    }

    if (existingScheduled) {
      const { error: updErr } = await supabase
        .from('billing_cycles')
        .update(scheduledPayload)
        .eq('id', existingScheduled.id)
      if (updErr) return { error: 'Error al actualizar el ciclo programado.' }
    } else {
      const { error: insErr } = await supabase
        .from('billing_cycles')
        .insert(scheduledPayload)
      if (insErr) return { error: 'Error al crear el ciclo programado.' }
    }

    revalidatePath('/renewals')
    revalidatePath(`/clients/${args.clientId}`)
    revalidatePath('/dashboard')
    return { ok: true, mode: 'scheduled' as const }
  }

  // ── Modo inmediato: archivar el ciclo viejo + crear el nuevo 'current' YA ──
  // Usa admin (service role) porque el cliente puede estar suspendido por impago
  // (inactive_payment) y RLS sobre `clients` podría bloquear el UPDATE de reactivación.
  const admin = createAdminClient()

  const clientUpdate: {
    status: 'active'
    deactivation_reason: null
    deactivated_at: null
    current_plan_id?: string
    billing_period?: BillingPeriod
  } = {
    status: 'active',
    deactivation_reason: null,
    deactivated_at: null,
  }
  if (args.withChanges && args.planId !== clientRow.current_plan_id) {
    clientUpdate.current_plan_id = args.planId
  }
  if (args.withChanges && args.billingPeriod !== clientRow.billing_period) {
    clientUpdate.billing_period = args.billingPeriod
  }

  const [{ error: archiveErr }, { error: clientErr }] = await Promise.all([
    admin.from('billing_cycles').update({ status: 'archived' }).eq('id', args.cycleId),
    admin.from('clients').update(clientUpdate).eq('id', args.clientId),
  ])

  if (archiveErr || clientErr) return { error: 'Error al archivar el ciclo anterior.' }

  // Si había un 'scheduled' pre-creado (por el cron de auto-billing o por una
  // renovación previa), la renovación inmediata lo supersede. Lo archivamos para
  // que el cron no lo promueva más adelante con fechas obsoletas (lo que dejaría
  // dos ciclos pisándose).
  await admin
    .from('billing_cycles')
    .update({ status: 'archived' })
    .eq('client_id', args.clientId)
    .eq('status', 'scheduled')

  const { data: newCycle, error: insertErr } = await admin
    .from('billing_cycles')
    .insert({
      client_id: args.clientId,
      plan_id_snapshot: args.planId,
      limits_snapshot_json: planLimits,
      rollover_from_previous_json: hasRollover ? rolloverJson : null,
      period_start: periodStart,
      period_end: periodEnd,
      status: 'current',
      payment_status: 'unpaid',
      billing_period: planRow.billing_period ?? 'monthly',
      no_expira: planRow.no_expira ?? false,
      cambios_budget: planRow.cambios_included + (args.withChanges ? args.cambiosPackages.reduce((s, p) => s + p.qty, 0) : 0),
      cambios_packages_json: args.withChanges ? args.cambiosPackages : [],
      extra_content_json: args.withChanges ? args.extraContent : [],
    })
    .select('id')
    .single()

  if (insertErr || !newCycle?.id) return { error: 'Error al crear el nuevo ciclo.' }

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await migrateOpenPipelineItems(supabase, {
      previousCycleId: args.cycleId,
      newCycleId: newCycle.id,
      movedBy: user.id,
    })
  }

  const { data: remainingReqs } = await supabase
    .from('requirements')
    .select('id')
    .eq('billing_cycle_id', args.cycleId)
  const remainingIds = (remainingReqs ?? []).map((r) => r.id)
  if (remainingIds.length > 0) {
    await cleanupCycleStorage(remainingIds)
  }

  revalidatePath('/renewals')
  revalidatePath('/clients')
  revalidatePath(`/clients/${args.clientId}`)
  revalidatePath('/pipeline')
  revalidatePath('/dashboard')

  return { ok: true, mode: 'immediate' as const }
}

export async function markCyclePaid(cycleId: string, clientId: string) {
  await requireAdminOrSupervisor()
  const supabase = await createClient()
  const { error } = await supabase
    .from('billing_cycles')
    .update({ payment_status: 'paid', payment_date: todayString() })
    .eq('id', cycleId)

  if (error) return { error: 'Error al marcar el ciclo como pagado.' }

  // Si el cliente estaba suspendido por impago, reactivarlo automáticamente.
  // Usa admin client + RPC para asegurar bypass de RLS y limpieza de campos auxiliares.
  const admin = createAdminClient()
  const { data: clientRow } = await admin
    .from('clients').select('status').eq('id', clientId).maybeSingle()
  if (clientRow?.status === 'inactive_payment') {
    await admin.rpc('reactivate_client', { p_client_id: clientId })
  }

  revalidatePath('/renewals')
  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/dashboard')
  return { ok: true }
}

/**
 * Reactiva manualmente a un cliente suspendido (admin o supervisor).
 * Limpia `status`, `deactivation_reason` y `deactivated_at`.
 */
export async function reactivateClient(clientId: string) {
  await assertNotImpersonating()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: appUser } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'admin' && appUser?.role !== 'supervisor') {
    return { error: 'Solo admin o supervisor puede reactivar clientes.' }
  }

  const admin = createAdminClient()
  const { error } = await admin.rpc('reactivate_client', { p_client_id: clientId })
  if (error) return { error: 'Error al reactivar el cliente.' }

  revalidatePath('/renewals')
  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/dashboard')
  return { ok: true }
}

/**
 * Otorga o extiende un período de gracia sobre el ciclo. Permite que el cliente
 * registre requerimientos aunque el ciclo esté impago. Si el cliente ya estaba
 * suspendido por impago, lo reactiva automáticamente.
 */
export async function deferPaymentGracePeriod(
  cycleId: string,
  clientId: string,
  days: number,
): Promise<{ ok: true; graceUntil: string } | { error: string }> {
  await assertNotImpersonating()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: appUser } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'admin' && appUser?.role !== 'supervisor') {
    return { error: 'Solo admin o supervisor puede otorgar período de gracia.' }
  }

  if (!Number.isInteger(days) || days < 1 || days > 60) {
    return { error: 'Los días deben estar entre 1 y 60.' }
  }

  const graceUntil = addDaysString(todayString(), days)

  const admin = createAdminClient()
  const { error } = await admin
    .from('billing_cycles')
    .update({
      grace_period_until: graceUntil,
      grace_period_granted_by: user.id,
      grace_period_granted_at: new Date().toISOString(),
    })
    .eq('id', cycleId)
  if (error) return { error: 'Error al otorgar período de gracia.' }

  // Si el cliente estaba suspendido por impago, reactivar automáticamente.
  const { data: clientRow } = await admin
    .from('clients').select('status').eq('id', clientId).maybeSingle()
  if (clientRow?.status === 'inactive_payment') {
    await admin.rpc('reactivate_client', { p_client_id: clientId })
  }

  revalidatePath('/renewals')
  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/dashboard')
  return { ok: true, graceUntil }
}

/**
 * Anula el período de gracia (admin se equivocó / cliente nunca pagó).
 * No reactiva ni suspende — solo limpia el flag. El cron del día siguiente
 * tratará al cliente como si nunca hubiera tenido gracia.
 */
export async function revokeGracePeriod(
  cycleId: string,
  clientId: string,
): Promise<{ ok: true } | { error: string }> {
  await assertNotImpersonating()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: appUser } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'admin' && appUser?.role !== 'supervisor') {
    return { error: 'Solo admin o supervisor puede anular período de gracia.' }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('billing_cycles')
    .update({
      grace_period_until: null,
      grace_period_granted_by: null,
      grace_period_granted_at: null,
    })
    .eq('id', cycleId)
  if (error) return { error: 'Error al anular período de gracia.' }

  revalidatePath('/renewals')
  revalidatePath(`/clients/${clientId}`)
  return { ok: true }
}

export async function pauseClient(clientId: string, cycleId: string) {
  await requireAdminOrSupervisor()
  const supabase = await createClient()
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabase.from('clients').update({ status: 'paused' }).eq('id', clientId),
    supabase.from('billing_cycles').update({ status: 'archived' }).eq('id', cycleId),
  ])

  if (e1 || e2) return { error: 'Error al pausar al cliente.' }

  // Limpiar todos los archivos del ciclo pausado (no hay migración, todo queda archivado)
  const { data: pausedReqs } = await supabase
    .from('requirements')
    .select('id')
    .eq('billing_cycle_id', cycleId)
  const pausedIds = (pausedReqs ?? []).map((r) => r.id)
  if (pausedIds.length > 0) {
    await cleanupCycleStorage(pausedIds)
  }

  revalidatePath('/renewals')
  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/clients')
  revalidatePath('/dashboard')
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────
// Actualizar fechas, estado de pago y estado del ciclo (solo admin)
// ─────────────────────────────────────────────────────────────────
export interface UpdateCycleDatesArgs {
  cycleId: string
  clientId: string
  periodStart: string          // YYYY-MM-DD
  periodEnd: string            // YYYY-MM-DD
  paymentStatus: PaymentStatus
  paymentDate: string | null   // YYYY-MM-DD o null
  paymentStatus2?: PaymentStatus | null
  paymentDate2?: string | null
}

export async function updateCycleDates(args: UpdateCycleDatesArgs) {
  // Auth check — solo admin o supervisor
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }
  const { data: appUser } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'admin' && appUser?.role !== 'supervisor') {
    return { error: 'Solo admin o supervisor puede modificar el ciclo' }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('billing_cycles')
    .update({
      period_start:     args.periodStart,
      period_end:       args.periodEnd,
      payment_status:   args.paymentStatus,
      payment_date:     args.paymentStatus === 'paid' ? (args.paymentDate || todayString()) : null,
      payment_status_2: args.paymentStatus2 ?? null,
      payment_date_2:   args.paymentStatus2 === 'paid' ? (args.paymentDate2 || null) : null,
    })
    .eq('id', args.cycleId)

  if (error) return { error: 'Error al actualizar el ciclo.' }

  revalidatePath(`/clients/${args.clientId}`)
  revalidatePath(`/clients/${args.clientId}/edit`)
  revalidatePath('/renewals')
  revalidatePath('/dashboard')
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────
// Crear un ciclo 'current' desde cero (cliente sin ciclo activo)
// ─────────────────────────────────────────────────────────────────
export interface CreateCurrentCycleArgs {
  clientId: string
  periodStart: string          // YYYY-MM-DD
  periodEnd: string            // YYYY-MM-DD
  paymentStatus: PaymentStatus
  paymentDate: string | null
  paymentStatus2?: PaymentStatus | null
  paymentDate2?: string | null
}

export async function createCurrentCycle(args: CreateCurrentCycleArgs) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }
  const { data: appUser } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'admin' && appUser?.role !== 'supervisor') {
    return { error: 'Solo admin o supervisor puede crear ciclos' }
  }

  if (!args.periodStart || !args.periodEnd) {
    return { error: 'Las fechas de inicio y fin son obligatorias.' }
  }

  const admin = createAdminClient()

  // Leer plan actual del cliente
  const { data: clientRow } = await admin
    .from('clients')
    .select('current_plan_id')
    .eq('id', args.clientId)
    .single()
  if (!clientRow) return { error: 'Cliente no encontrado.' }

  const { data: planRow } = await admin
    .from('plans')
    .select('*')
    .eq('id', clientRow.current_plan_id)
    .single()
  if (!planRow) return { error: 'Plan del cliente no encontrado.' }

  const planLimits: PlanLimits = planRow.unified_content_limit != null
    ? { ...planRow.limits_json, unified_content_limit: planRow.unified_content_limit }
    : planRow.limits_json

  const { error: insertErr } = await admin
    .from('billing_cycles')
    .insert({
      client_id:              args.clientId,
      plan_id_snapshot:       clientRow.current_plan_id,
      limits_snapshot_json:   planLimits,
      period_start:           args.periodStart,
      period_end:             args.periodEnd,
      status:                 'current',
      payment_status:         args.paymentStatus,
      payment_date:           args.paymentStatus === 'paid' ? (args.paymentDate || todayString()) : null,
      payment_status_2:       args.paymentStatus2 ?? null,
      payment_date_2:         args.paymentStatus2 === 'paid' ? (args.paymentDate2 || null) : null,
      cambios_budget:         planRow.cambios_included,
      cambios_packages_json:  [],
      extra_content_json:     [],
      billing_period:         planRow.billing_period ?? 'monthly',
      no_expira:              planRow.no_expira ?? false,
    })

  if (insertErr) return { error: 'Error al crear el ciclo.' }

  // Activar el cliente
  await admin.from('clients').update({ status: 'active' }).eq('id', args.clientId)

  revalidatePath(`/clients/${args.clientId}`)
  revalidatePath(`/clients/${args.clientId}/edit`)
  revalidatePath('/renewals')
  revalidatePath('/dashboard')
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────
// Rescatar requerimientos huérfanos.
//
// Operación en 3 fases:
//
// FASE 1 — Limpieza de phase_logs falsos en todos los requerimientos
//   relevantes del cliente. Versiones anteriores insertaban un log
//   "Trasladado..." / "Rescatado..." con created_at=NOW() que rompía
//   el cálculo de last_moved_at (timer mostraba "X min desde rescate"
//   en vez de "X min en la fase real").
//
// FASE 2 — Resolver duplicados en el ciclo current. Una versión rota
//   anterior creaba COPIAS (INSERT) en vez de mover. Por cada
//   `carried_over=true` en el ciclo current:
//     - Buscar matching original en ciclos archivados (title+content_type).
//     - Si se encuentra match Y el duplicado está vacío → borrar duplicado.
//     - Si match Y el duplicado tiene datos → MERGE: mover los datos
//       (time_entries, messages, review_assets, cambio_logs, mentions)
//       al original; borrar duplicado.
//     - Si NO hay match Y el duplicado está vacío → borrar (es un
//       leftover de un rescate previo — el original ya fue movido en
//       una corrida anterior).
//     - Si NO hay match Y tiene datos → keep (es un original ya
//       movido legítimamente, o tiene trabajo real que no podemos
//       reasignar automáticamente).
//
// FASE 3 — Mover los huérfanos restantes (los originales en archivados
//   que no se procesaron en FASE 2) al ciclo current con carried_over=true.
// ─────────────────────────────────────────────────────────────────
export interface RescueDiagnostics {
  archivedCyclesCount: number
  archivedReqsTotal: number
  archivedReqsBreakdown: {
    voided: number
    publicado_entregado: number
    not_pipeline_type: number
    open_pipeline: number
  }
  currentCycleCarriedOver: number
}

export async function rescueOrphanedRequirements(
  clientId: string
): Promise<
  | {
      ok: true
      moved: number               // huérfanos movidos sin duplicado
      duplicatesReplaced: number  // duplicados reemplazados con su original
      duplicatesDeleted: number   // duplicados vacíos borrados sin original (leftover)
      duplicatesMerged: number    // duplicados con datos fusionados al original
      duplicatesKept: number      // duplicados conservados (con datos y sin original)
      diagnostics: RescueDiagnostics
    }
  | { error: string }
> {
  await assertNotImpersonating()
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }
  const { data: appUser } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'admin' && appUser?.role !== 'supervisor') {
    return { error: 'Solo admin o supervisor puede rescatar requerimientos.' }
  }

  // Ciclo current
  const { data: currentCycle } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('client_id', clientId)
    .eq('status', 'current')
    .maybeSingle()
  if (!currentCycle) {
    return { error: 'El cliente no tiene un ciclo current activo. Crea uno antes de rescatar.' }
  }

  // Ciclos archivados
  const { data: archivedCycles } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('client_id', clientId)
    .in('status', ['archived', 'pending_renewal'])
  const archivedIds = (archivedCycles ?? []).map((c) => c.id)

  // Carried-over en current (potenciales duplicados o originales ya movidos)
  const { data: carriedOverRaw } = await supabase
    .from('requirements')
    .select('id, content_type, title')
    .eq('billing_cycle_id', currentCycle.id)
    .eq('carried_over', true)
  const carriedOver = (carriedOverRaw ?? []) as Array<{ id: string; content_type: string; title: string | null }>

  // Diagnóstico inicial
  const baseDiagnostics: RescueDiagnostics = {
    archivedCyclesCount: archivedIds.length,
    archivedReqsTotal: 0,
    archivedReqsBreakdown: {
      voided: 0,
      publicado_entregado: 0,
      not_pipeline_type: 0,
      open_pipeline: 0,
    },
    currentCycleCarriedOver: carriedOver.length,
  }

  // Reqs en archivados (huérfanos potenciales)
  let allArchivedReqs: Array<{
    id: string
    content_type: string
    phase: string
    voided: boolean
    title: string | null
  }> = []
  if (archivedIds.length > 0) {
    const { data: rows } = await supabase
      .from('requirements')
      .select('id, content_type, phase, voided, title')
      .in('billing_cycle_id', archivedIds)
    allArchivedReqs = (rows ?? []) as typeof allArchivedReqs

    baseDiagnostics.archivedReqsTotal = allArchivedReqs.length
    for (const r of allArchivedReqs) {
      if (r.voided) baseDiagnostics.archivedReqsBreakdown.voided++
      else if (r.phase === 'publicado_entregado') baseDiagnostics.archivedReqsBreakdown.publicado_entregado++
      else if (!PIPELINE_CONTENT_TYPES.includes(r.content_type as ContentType)) baseDiagnostics.archivedReqsBreakdown.not_pipeline_type++
      else baseDiagnostics.archivedReqsBreakdown.open_pipeline++
    }
  }

  const orphans = allArchivedReqs.filter(
    (r) =>
      !r.voided &&
      r.phase !== 'publicado_entregado' &&
      PIPELINE_CONTENT_TYPES.includes(r.content_type as ContentType)
  )

  // Admin client para todas las operaciones de mantenimiento (bypassea
  // RLS por si alguna policy bloquea silenciosamente DELETE/UPDATE).
  const admin = createAdminClient()

  // ── FASE 1: Limpieza de phase_logs falsos ──────────────────────
  const reqsToCleanLogs = [...carriedOver.map((r) => r.id), ...orphans.map((r) => r.id)]
  if (reqsToCleanLogs.length > 0) {
    await admin
      .from('requirement_phase_logs')
      .delete()
      .in('requirement_id', reqsToCleanLogs)
      .in('notes', BOGUS_MIGRATION_NOTES)
  }

  // ── FASE 2: Resolver duplicados en current ─────────────────────

  // Index de huérfanos por title+content_type
  const orphanKey = (r: { content_type: string; title: string | null }) =>
    `${r.content_type}::${(r.title ?? '').trim().toLowerCase()}`
  const orphanByKey = new Map<string, typeof orphans[number]>()
  for (const o of orphans) {
    const key = orphanKey(o)
    if (!orphanByKey.has(key)) orphanByKey.set(key, o)
  }

  const handledOrphanIds = new Set<string>()

  let duplicatesReplaced = 0
  let duplicatesMerged = 0
  let duplicatesDeleted = 0
  let duplicatesKept = 0
  const errors: string[] = []

  for (const dup of carriedOver) {
    const key = orphanKey(dup)
    const matchingOrphan = orphanByKey.get(key)
    const isEmpty = await isDuplicateEmpty(admin, dup.id)

    if (matchingOrphan) {
      // Hay original en archivado: reemplazar dup con original
      if (!isEmpty) {
        await mergeReqData(dup.id, matchingOrphan.id)
        duplicatesMerged++
      } else {
        duplicatesReplaced++
      }
      // Borrar phase_logs del dup (no FK CASCADE) y luego el dup
      const { error: logErr } = await admin
        .from('requirement_phase_logs').delete().eq('requirement_id', dup.id)
      if (logErr) errors.push(`logs ${dup.id}: ${logErr.message}`)
      const { error: reqErr } = await admin
        .from('requirements').delete().eq('id', dup.id)
      if (reqErr) errors.push(`req ${dup.id}: ${reqErr.message}`)

      handledOrphanIds.add(matchingOrphan.id)
      orphanByKey.delete(key)
    } else {
      // No hay match en archivado
      if (isEmpty) {
        // Leftover: el original probablemente ya fue movido en una corrida
        // anterior. El dup es basura.
        const { error: logErr } = await admin
          .from('requirement_phase_logs').delete().eq('requirement_id', dup.id)
        if (logErr) errors.push(`logs ${dup.id}: ${logErr.message}`)
        const { error: reqErr } = await admin
          .from('requirements').delete().eq('id', dup.id)
        if (reqErr) errors.push(`req ${dup.id}: ${reqErr.message}`)
        else duplicatesDeleted++
      } else {
        duplicatesKept++
      }
    }
  }

  if (errors.length > 0) {
    console.error('[rescue] errors during cleanup:', errors)
  }

  // ── FASE 3: Mover huérfanos a current ──────────────────────────
  let moved = 0
  for (const orphan of orphans) {
    const { error: updErr } = await admin
      .from('requirements')
      .update({ billing_cycle_id: currentCycle.id, carried_over: true })
      .eq('id', orphan.id)
    if (updErr) {
      console.error('[rescue] move failed', updErr)
      continue
    }
    if (!handledOrphanIds.has(orphan.id)) {
      moved++
    }
  }

  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/pipeline')
  revalidatePath('/dashboard')
  return {
    ok: true,
    moved,
    duplicatesReplaced,
    duplicatesDeleted,
    duplicatesMerged,
    duplicatesKept,
    diagnostics: baseDiagnostics,
  }
}

/**
 * Mueve TODA la data relacionada de `fromId` a `toId`. Tablas con
 * `requirement_id`: time_entries, requirement_messages,
 * requirement_cambio_logs, review_assets, requirement_mentions,
 * review_comment_mentions. NO mueve `requirement_phase_logs` — esos
 * representan la timeline de fases del original que se conserva.
 *
 * Usa admin client porque algunas tablas tienen Update types restrictivos
 * en TS y queremos bypassear RLS para esta operación de mantenimiento.
 */
async function mergeReqData(fromId: string, toId: string): Promise<void> {
  const admin = createAdminClient()
  const updateReqId = (table: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin.from(table) as any).update({ requirement_id: toId }).eq('requirement_id', fromId)

  await Promise.all([
    updateReqId('time_entries'),
    updateReqId('requirement_messages'),
    updateReqId('requirement_cambio_logs'),
    updateReqId('review_assets'),
    updateReqId('requirement_mentions'),
    updateReqId('review_comment_mentions'),
  ])
}

/**
 * Notas exactas de phase_logs que las versiones anteriores del rescate
 * y la migración insertaban como "auditoría". Se borran para devolver
 * los timers de fase a su valor real.
 */
const BOGUS_MIGRATION_NOTES = [
  'Trasladado del ciclo anterior',
  'Trasladado del ciclo anterior (cron)',
  'Trasladado del ciclo anterior (traslado manual)',
  'Rescatado del ciclo anterior',
  'Rescatado: original movido al ciclo actual (reemplaza copia vacía)',
] as const

/**
 * Un duplicado se considera "vacío" si NO tiene NINGUNO de:
 * - time_entries
 * - requirement_messages
 * - review_assets
 * - requirement_cambio_logs
 *
 * Los phase_logs no cuentan: el rescate viejo los copió del original,
 * pero no representan trabajo del usuario sobre el duplicado.
 *
 * Usa admin client porque RLS sobre tablas como review_assets o
 * requirement_cambio_logs podría devolver counts incorrectos al usuario,
 * causando falsos negativos (creer que el dup tiene datos cuando no).
 */
async function isDuplicateEmpty(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  dupId: string
): Promise<boolean> {
  const [te, rm, ra, cl] = await Promise.all([
    admin.from('time_entries').select('id', { head: true, count: 'exact' }).eq('requirement_id', dupId),
    admin.from('requirement_messages').select('id', { head: true, count: 'exact' }).eq('requirement_id', dupId),
    admin.from('review_assets').select('id', { head: true, count: 'exact' }).eq('requirement_id', dupId),
    admin.from('requirement_cambio_logs').select('id', { head: true, count: 'exact' }).eq('requirement_id', dupId),
  ])
  if ((te.count ?? 0) > 0) return false
  if ((rm.count ?? 0) > 0) return false
  if ((ra.count ?? 0) > 0) return false
  if ((cl.count ?? 0) > 0) return false
  return true
}
