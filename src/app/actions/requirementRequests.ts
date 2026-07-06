'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveClientId } from '@/lib/supabase/active-client'
import { assertNotImpersonating } from './impersonation'
import type { ContentType, Priority, ClientRequestAttachment, ClientRequestLink } from '@/types/db'
import { isWeekUnlocked, weekIndexInCycle, maxWeeksForPeriod } from '@/lib/domain/requirement'
import { ALLOWED_REQUEST_TYPES, SCHEDULED_TYPES } from '@/lib/domain/requirementRequest'

export interface RequestRequirementInput {
  contentType: ContentType
  title: string
  description: string
  /**
   * Para reunion/produccion: ISO datetime (starts_at).
   * Para artes (historia, estatico, video_corto, reel, short): fecha YYYY-MM-DD (deadline).
   */
  desiredAt: string
  includesStory?: boolean
}

/**
 * Core de creación de solicitud — sin dependencia de sesión browser.
 * Invocable desde el server action (portal) y desde el bot de WhatsApp.
 *
 * Validaciones aquí: tipos, status del cliente, ciclo activo, semana pagada.
 * NO valida can_work — el caller decide si debe (portal sí, bot omite porque
 * la conv ya está vinculada al cliente).
 */
export async function createRequirementRequestCore(args: {
  clientId: string
  /** UUID del user que figura como autor de la solicitud (puede ser FM Bot). */
  requestedByUserId: string
  contentType: ContentType
  title: string
  description?: string | null
  desiredAt: string
  includesStory?: boolean
  /** 'portal' (default) | 'whatsapp_bot' | 'staff' | 'unknown' */
  requestedVia?: 'portal' | 'whatsapp_bot' | 'staff' | 'unknown'
}): Promise<{ ok: true; id: string } | { error: string }> {
  if (!(ALLOWED_REQUEST_TYPES as readonly ContentType[]).includes(args.contentType)) {
    return { error: 'Tipo no permitido para solicitudes' }
  }
  if (!args.title.trim()) return { error: 'Ingresa un título' }
  if (!args.desiredAt) return { error: 'Selecciona la fecha deseada' }

  const admin = createAdminClient()

  // Status del cliente.
  const { data: clientRow } = await admin
    .from('clients')
    .select('status, billing_period')
    .eq('id', args.clientId)
    .single()
  if (!clientRow) return { error: 'Marca no encontrada' }
  if (clientRow.status === 'inactive_payment') {
    return { error: 'La cuenta está suspendida por falta de pago. Contacta a tu agencia.' }
  }
  if (clientRow.status === 'inactive_manual') {
    return { error: 'La cuenta está desactivada. Contacta a tu agencia.' }
  }

  // Ciclo activo. Incluimos grace_period_until y billing_period del ciclo para que
  // el gate de semana coincida EXACTO con el trigger SQL (que lee bc.grace_period_until
  // y bc.billing_period). Sin grace_period_until, un cliente con gracia vigente era
  // bloqueado falsamente aquí y la solicitud del bot nunca se creaba.
  const { data: cycle } = await admin
    .from('billing_cycles')
    .select('id, period_start, payment_status, payment_status_2, grace_period_until, billing_period')
    .eq('client_id', args.clientId)
    .eq('status', 'current')
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!cycle) return { error: 'No hay ciclo de facturación activo para esta marca' }

  // Semana pagada (defensa además del trigger SQL). Usar el billing_period del
  // ciclo (snapshot) y el maxWeek correcto (8 para bimonthly) — de lo contrario
  // los clientes bimestrales en S5-S8 se evaluaban contra el pago equivocado.
  const cycleBillingPeriod = (cycle.billing_period ?? clientRow.billing_period) as typeof clientRow.billing_period
  const week = weekIndexInCycle(
    new Date(),
    cycle.period_start as string,
    maxWeeksForPeriod(cycleBillingPeriod),
  )
  if (
    !isWeekUnlocked(
      week,
      cycle as unknown as Parameters<typeof isWeekUnlocked>[1],
      { billing_period: cycleBillingPeriod },
    )
  ) {
    return { error: 'No se puede crear solicitudes en esta semana sin el pago correspondiente. Contacta a tu agencia.' }
  }

  const isScheduled = (SCHEDULED_TYPES as readonly ContentType[]).includes(args.contentType)
  const startsAt = isScheduled ? args.desiredAt : null
  const deadline = isScheduled ? null : args.desiredAt
  const clientRequestedDeadline = isScheduled ? args.desiredAt : `${args.desiredAt}T00:00:00`
  const cleanedDescription = (args.description ?? '').trim() || null

  const { data: inserted, error } = await admin
    .from('requirements')
    .insert({
      billing_cycle_id: cycle.id,
      content_type: args.contentType,
      registered_by_user_id: args.requestedByUserId,
      title: args.title.trim(),
      notes: cleanedDescription,
      voided: false,
      over_limit: false,
      phase: 'pendiente',
      carried_over: false,
      cambios_count: 0,
      includes_story: args.includesStory ?? false,
      approval_status: 'pending',
      requested_by_user_id: args.requestedByUserId,
      client_requested_deadline: clientRequestedDeadline,
      client_requested_notes: cleanedDescription,
      starts_at: startsAt,
      deadline,
      assigned_to: [],
      requested_via: args.requestedVia ?? 'portal',
    } as never)
    .select('id')
    .single()

  if (error || !inserted) {
    console.error('[createRequirementRequestCore]', error)
    return { error: error?.message ?? 'No se pudo crear la solicitud' }
  }

  return { ok: true, id: (inserted as { id: string }).id }
}

/**
 * Server action invocado desde el portal del cliente. Crea un requirement
 * con `approval_status='pending'` y solo los campos que el cliente puede
 * llenar (título, descripción, fecha deseada). El staff completa lo demás
 * al aprobar.
 */
export async function requestRequirement(
  input: RequestRequirementInput,
): Promise<{ ok: true; id: string } | { error: string }> {
  await assertNotImpersonating()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const activeClientId = await getActiveClientId()
  if (!activeClientId) return { error: 'No hay marca activa' }

  // Verifica permiso can_work — específico del flujo portal, no del core.
  const admin = createAdminClient()
  const { data: link } = await admin
    .from('client_users')
    .select('can_work')
    .eq('user_id', user.id)
    .eq('client_id', activeClientId)
    .maybeSingle()
  if (!link?.can_work) {
    return { error: 'No tienes permiso para solicitar requerimientos en esta marca' }
  }

  const result = await createRequirementRequestCore({
    clientId: activeClientId,
    requestedByUserId: user.id,
    contentType: input.contentType,
    title: input.title,
    description: input.description,
    desiredAt: input.desiredAt,
    includesStory: input.includesStory,
    requestedVia: 'portal',
  })

  if ('ok' in result) {
    revalidatePath('/portal/dashboard')
    revalidatePath('/requirements/solicitudes')
  }
  return result
}

export interface ApproveRequirementInput {
  requirementId: string
  /** Obligatorio para reunion/produccion. Opcional para artes. */
  estimatedTimeMinutes: number | null
  priority: Priority
  assignedTo: string[]
  deadline: string | null
  /** Solo aplica a reunion/produccion. */
  startsAt: string | null
  /** Solo aplica a artes story-eligible (estatico, video_corto, reel, short). */
  includesStory?: boolean
  /** Solo admins pueden enviar overrides; el server lo ignora si no lo es. */
  consumptionOverridesJson?: Partial<Record<ContentType, number>> | null
}

const STORY_ELIGIBLE = ['estatico', 'video_corto', 'reel', 'short'] as const satisfies readonly ContentType[]

export async function approveRequirementRequest(
  input: ApproveRequirementInput,
): Promise<{ ok: true } | { error: string }> {
  await assertNotImpersonating()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: appUser } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (!appUser || !['admin', 'supervisor'].includes(appUser.role)) {
    return { error: 'Solo admins y supervisores pueden aprobar solicitudes' }
  }

  if (!input.assignedTo.length) return { error: 'Asigna al menos un responsable' }

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('requirements')
    .select('id, approval_status, content_type')
    .eq('id', input.requirementId)
    .maybeSingle()
  if (!existing) return { error: 'Solicitud no encontrada' }
  if (existing.approval_status !== 'pending') {
    return { error: 'Esta solicitud ya fue procesada' }
  }

  const ct = existing.content_type as ContentType
  const isScheduled = (SCHEDULED_TYPES as readonly ContentType[]).includes(ct)
  const isStoryEligible = (STORY_ELIGIBLE as readonly ContentType[]).includes(ct)
  if (isScheduled) {
    if (!input.estimatedTimeMinutes || input.estimatedTimeMinutes <= 0) {
      return { error: 'Ingresa la duración estimada en minutos' }
    }
    if (!input.startsAt) return { error: 'Selecciona la fecha y hora de inicio' }
  } else {
    if (!input.deadline) return { error: 'Selecciona la fecha de entrega' }
  }

  // Solo admins pueden forzar consumo personalizado.
  const isAdmin = appUser.role === 'admin'
  const overrides = isAdmin ? (input.consumptionOverridesJson ?? null) : null
  const hasOverrides = overrides && Object.values(overrides).some((v) => (v ?? 0) > 0)

  const { error } = await admin
    .from('requirements')
    .update({
      approval_status: 'approved',
      approved_by_user_id: user.id,
      approved_at: new Date().toISOString(),
      estimated_time_minutes: input.estimatedTimeMinutes ?? null,
      priority: input.priority,
      assigned_to: input.assignedTo,
      deadline: input.deadline,
      starts_at: isScheduled ? input.startsAt : null,
      includes_story: isStoryEligible ? !!input.includesStory : false,
      consumption_overrides_json: hasOverrides ? overrides : null,
    })
    .eq('id', input.requirementId)

  if (error) {
    console.error('[approveRequirementRequest]', error)
    return { error: 'No se pudo aprobar la solicitud' }
  }

  revalidatePath('/requirements/solicitudes')
  revalidatePath('/pipeline')
  revalidatePath('/calendario')
  revalidatePath('/portal/dashboard')
  revalidatePath('/portal/pipeline')
  return { ok: true }
}

export async function rejectRequirementRequest(
  requirementId: string,
  reason: string,
): Promise<{ ok: true } | { error: string }> {
  await assertNotImpersonating()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: appUser } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (!appUser || !['admin', 'supervisor'].includes(appUser.role)) {
    return { error: 'Solo admins y supervisores pueden rechazar solicitudes' }
  }

  if (!reason.trim()) return { error: 'Indica un motivo de rechazo' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('requirements')
    .update({
      approval_status: 'rejected',
      rejected_reason: reason.trim(),
      rejected_at: new Date().toISOString(),
      rejected_by_user_id: user.id,
    })
    .eq('id', requirementId)
    .eq('approval_status', 'pending')

  if (error) {
    console.error('[rejectRequirementRequest]', error)
    return { error: 'No se pudo rechazar la solicitud' }
  }

  revalidatePath('/requirements/solicitudes')
  revalidatePath('/portal/dashboard')
  return { ok: true }
}

export interface UpdateRequirementRequestInput {
  requirementId: string
  title: string
  /** Se guarda en requirements.notes y client_requested_notes */
  description: string
  desiredAt: string
  includesStory?: boolean
  /** Array final: existentes (no removidos) + nuevos ya subidos al bucket */
  attachments: ClientRequestAttachment[]
  links: ClientRequestLink[]
}

export async function updateRequirementRequest(
  input: UpdateRequirementRequestInput,
): Promise<{ ok: true } | { error: string }> {
  await assertNotImpersonating()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const admin = createAdminClient()

  // Verificar que la solicitud exista, sea pending y pertenezca a este usuario
  const { data: existing } = await admin
    .from('requirements')
    .select('id, approval_status, requested_by_user_id, content_type')
    .eq('id', input.requirementId)
    .maybeSingle()

  if (!existing) return { error: 'Solicitud no encontrada' }
  if (existing.approval_status !== 'pending') return { error: 'Esta solicitud ya fue procesada y no puede editarse' }
  if (existing.requested_by_user_id !== user.id) return { error: 'Sin permiso para editar esta solicitud' }

  // Validar inputs ANTES de cualquier operación de storage
  if (!input.title.trim()) return { error: 'El título no puede estar vacío' }
  if (!input.desiredAt) return { error: 'Selecciona la fecha deseada' }

  const ct = existing.content_type as ContentType
  const isScheduled = (SCHEDULED_TYPES as readonly ContentType[]).includes(ct)
  const startsAt = isScheduled ? input.desiredAt : null
  const deadline = isScheduled ? null : input.desiredAt
  const clientRequestedDeadline = isScheduled
    ? input.desiredAt
    : `${input.desiredAt}T00:00:00`

  // Borrar del bucket los archivos que el usuario eliminó en la edición
  const { data: current } = await admin
    .from('requirements')
    .select('client_request_attachments_json')
    .eq('id', input.requirementId)
    .single()

  const oldPaths: string[] = (current?.client_request_attachments_json ?? []).map(
    (a: { path: string }) => a.path
  )
  const newPaths = new Set(input.attachments.map((a) => a.path))
  const removedPaths = oldPaths.filter((p) => !newPaths.has(p))

  if (removedPaths.length > 0) {
    await admin.storage
      .from('requirement-attachments')
      .remove(removedPaths)
  }

  const { error } = await admin
    .from('requirements')
    .update({
      title: input.title.trim(),
      notes: input.description.trim() || null,
      client_requested_notes: input.description.trim() || null,
      client_requested_deadline: clientRequestedDeadline,
      starts_at: startsAt,
      deadline,
      includes_story: (STORY_ELIGIBLE as readonly ContentType[]).includes(ct) ? !!input.includesStory : false,
      client_request_attachments_json: input.attachments.length > 0 ? input.attachments : null,
      client_request_links_json: input.links.length > 0 ? input.links : null,
    })
    .eq('id', input.requirementId)

  if (error) {
    console.error('[updateRequirementRequest]', error)
    return { error: 'No se pudo actualizar la solicitud' }
  }

  revalidatePath('/portal/dashboard')
  return { ok: true }
}

export async function cancelRequirementRequest(
  requirementId: string,
): Promise<{ ok: true } | { error: string }> {
  await assertNotImpersonating()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('requirements')
    .select('id, approval_status, requested_by_user_id, client_request_attachments_json')
    .eq('id', requirementId)
    .maybeSingle()

  if (!existing) return { error: 'Solicitud no encontrada' }
  if (existing.approval_status !== 'pending') return { error: 'Esta solicitud ya fue procesada' }
  if (existing.requested_by_user_id !== user.id) return { error: 'Sin permiso para cancelar esta solicitud' }

  // 1. Marcar como voided primero — si falla, los archivos permanecen intactos
  const { error: voidErr } = await admin
    .from('requirements')
    .update({ voided: true })
    .eq('id', requirementId)

  if (voidErr) {
    console.error('[cancelRequirementRequest]', voidErr)
    return { error: 'No se pudo cancelar la solicitud' }
  }

  // 2. Borrar archivos del bucket (best-effort — si falla se puede limpiar después)
  const attachments = (existing.client_request_attachments_json ?? []) as ClientRequestAttachment[]
  if (attachments.length > 0) {
    const paths = attachments.map((a) => a.path)
    await admin.storage.from('requirement-attachments').remove(paths)
  }

  revalidatePath('/portal/dashboard')
  return { ok: true }
}
