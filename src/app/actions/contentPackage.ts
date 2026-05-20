'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { cleanupCycleStorage } from '@/lib/supabase/cleanup-cycle-storage'
import { today as todayGMT6, addDaysString } from '@/lib/domain/dates'
import { migrateOpenPipelineItems } from '@/lib/domain/pipeline'

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

  const today = todayGMT6()
  const farFuture = addDaysString(today, 10 * 365)

  const snapshot = plan.unified_content_limit != null
    ? { ...plan.limits_json, unified_content_limit: plan.unified_content_limit }
    : plan.limits_json

  const { data: newCycle, error: createError } = await supabase
    .from('billing_cycles')
    .insert({
      client_id: clientId,
      plan_id_snapshot: planId,
      limits_snapshot_json: snapshot,
      rollover_from_previous_json: null,
      period_start: today,
      period_end: farFuture,
      status: 'current',
      payment_status: 'unpaid',
      no_expira: plan.no_expira ?? false,
    })
    .select('id')
    .single()
  if (createError || !newCycle?.id) {
    return { error: createError?.message ?? 'Error al crear el nuevo ciclo.' }
  }

  // Mover requerimientos abiertos (no publicados) al nuevo ciclo antes del cleanup,
  // para que sus archivos en review-files no se borren junto a los del ciclo archivado.
  await migrateOpenPipelineItems(supabase, {
    previousCycleId: currentCycleId,
    newCycleId: newCycle.id,
    movedBy: user.id,
  })

  // Limpiar archivos del ciclo archivado (solo reqs en publicado_entregado quedan ahí)
  const { data: closedReqs } = await supabase
    .from('requirements')
    .select('id')
    .eq('billing_cycle_id', currentCycleId)
  const closedIds = (closedReqs ?? []).map((r) => r.id)
  if (closedIds.length > 0) {
    await cleanupCycleStorage(closedIds)
  }

  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/clients')
  return {}
}
