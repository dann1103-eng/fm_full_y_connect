'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

/**
 * Archiva el ciclo Contenido actual y crea uno nuevo con los mismos límites.
 * Llamado cuando el pool de 10 contenidos se agota y el cliente compra otro paquete.
 */
export async function renewContentPackage(
  currentCycleId: string,
  clientId: string,
  planId: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: appUser } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (!appUser || !['admin', 'supervisor'].includes(appUser.role ?? '')) {
    return { error: 'Sin permisos' }
  }

  // Archive current cycle
  const { error: archiveError } = await supabase
    .from('billing_cycles')
    .update({ status: 'archived' })
    .eq('id', currentCycleId)
  if (archiveError) return { error: archiveError.message }

  // Fetch plan to snapshot limits
  const { data: plan, error: planError } = await supabase
    .from('plans').select('*').eq('id', planId).single()
  if (planError || !plan) return { error: 'Plan no encontrado' }

  const today = new Date().toISOString().split('T')[0]
  const farFuture = new Date(new Date().getTime() + 10 * 365 * 24 * 60 * 60 * 1000)
    .toISOString().split('T')[0]

  const snapshot = plan.unified_content_limit != null
    ? { ...plan.limits_json, unified_content_limit: plan.unified_content_limit }
    : plan.limits_json

  const { error: createError } = await supabase.from('billing_cycles').insert({
    client_id: clientId,
    plan_id_snapshot: planId,
    limits_snapshot_json: snapshot,
    rollover_from_previous_json: null,
    period_start: today,
    period_end: farFuture,
    status: 'current',
    payment_status: 'unpaid',
  })
  if (createError) return { error: createError.message }

  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/clients')
  return {}
}
