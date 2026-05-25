'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { consumeCredit, refundCredit, getAvailableContentCredits, getAvailableCambiosCredits } from '@/lib/domain/credits'
import { CONTENT_TYPE_TO_CREDIT_KIND } from '@/types/db'
import { requireUser } from '@/lib/auth/require-user'
import type { ContentType } from '@/types/db'

/**
 * Devuelve los créditos disponibles de un cliente (cambios + contenido).
 * Usado por la UI del perfil del cliente para mostrar el saldo y por
 * el modal de creación para validar si un requerimiento puede consumir crédito.
 */
export async function listClientCredits(clientId: string) {
  const { supabase } = await requireUser({ allowImpersonation: true })
  const [content, cambios] = await Promise.all([
    getAvailableContentCredits(supabase, clientId),
    getAvailableCambiosCredits(supabase, clientId),
  ])
  return { content, cambios }
}

/**
 * Consume un crédito de contenido para un requerimiento recién creado.
 * Llamar inmediatamente después del insert si el requerimiento excedió el cupo del ciclo.
 * Si no hay crédito disponible o falla, retorna ok:false; el caller debe anular el requerimiento.
 *
 * Idempotente: si el requerimiento ya tiene `paid_from_credit_id`, retorna ok:true.
 */
export async function consumeContentCreditForRequirement(args: {
  requirementId: string
  contentType: ContentType
}): Promise<{ ok: true; creditId: string | null } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado' }

  const admin = createAdminClient()

  const { data: req } = await admin
    .from('requirements')
    .select('id, billing_cycle_id, content_type, paid_from_credit_id')
    .eq('id', args.requirementId)
    .single()
  if (!req) return { ok: false, error: 'Requerimiento no encontrado' }
  if (req.paid_from_credit_id) return { ok: true, creditId: req.paid_from_credit_id as string }

  const { data: cycle } = await admin
    .from('billing_cycles')
    .select('client_id')
    .eq('id', req.billing_cycle_id as string)
    .maybeSingle()
  const clientId = cycle?.client_id ?? null
  if (!clientId) return { ok: false, error: 'Ciclo del requerimiento no encontrado' }

  const kind = CONTENT_TYPE_TO_CREDIT_KIND[args.contentType]
  if (!kind) return { ok: false, error: 'Tipo de contenido no soporta créditos' }

  const creditId = await consumeCredit(admin, { clientId, kind })
  if (!creditId) return { ok: false, error: 'Sin créditos disponibles' }

  const { error: updErr } = await admin
    .from('requirements')
    .update({ paid_from_credit_id: creditId, over_limit: false })
    .eq('id', args.requirementId)
  if (updErr) {
    await refundCredit(admin, creditId)
    return { ok: false, error: 'No se pudo asociar el crédito al requerimiento' }
  }

  revalidatePath(`/clients/${clientId}`)
  return { ok: true, creditId }
}

/**
 * Devuelve un crédito al anular un requerimiento que fue cubierto por un paquete sin caducidad.
 */
export async function refundContentCreditForRequirement(args: {
  requirementId: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado' }

  const admin = createAdminClient()
  const { data: req } = await admin
    .from('requirements')
    .select('paid_from_credit_id, billing_cycle_id')
    .eq('id', args.requirementId)
    .single()
  if (!req) return { ok: false, error: 'Requerimiento no encontrado' }
  if (!req.paid_from_credit_id) return { ok: true }

  await refundCredit(admin, req.paid_from_credit_id as string)
  await admin
    .from('requirements')
    .update({ paid_from_credit_id: null })
    .eq('id', args.requirementId)

  const { data: cycle } = await admin
    .from('billing_cycles')
    .select('client_id')
    .eq('id', req.billing_cycle_id as string)
    .maybeSingle()
  if (cycle?.client_id) revalidatePath(`/clients/${cycle.client_id}`)

  return { ok: true }
}
