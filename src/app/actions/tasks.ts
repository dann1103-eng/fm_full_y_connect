'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from './impersonation'
import { getActiveEntry, findOverlappingEntry, overlapErrorMsg } from '@/lib/time/entry-guards'

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getAuthUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
  return { supabase, user }
}

async function assertAdminOrSupervisor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data } = await supabase.from('users').select('role').eq('id', userId).single()
  if (data?.role !== 'admin' && data?.role !== 'supervisor') throw new Error('Sin permisos')
}

/** Cierra (si existe) el timer activo de una tarea, dejándolo con duración real. */
async function closeActiveTimerOnTask(
  admin: ReturnType<typeof createAdminClient>,
  taskId: string,
) {
  const { data: active } = await admin
    .from('time_entries')
    .select('id, started_at')
    .eq('task_id', taskId)
    .is('ended_at', null)
    .maybeSingle()
  if (!active) return
  const endedAt = new Date()
  const dur = Math.max(0, Math.round((endedAt.getTime() - new Date(active.started_at).getTime()) / 1000))
  await admin
    .from('time_entries')
    .update({ ended_at: endedAt.toISOString(), duration_seconds: dur })
    .eq('id', active.id)
}

// ── Crear tarea (admin/supervisor) ───────────────────────────────────────────

export async function createTask(payload: {
  title: string
  description?: string
  clientRef?: string
  assignedToUserId: string
}): Promise<{ success: true; taskId: string } | { error: string }> {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()
  await assertAdminOrSupervisor(supabase, user.id)

  const title = payload.title.trim()
  if (!title) return { error: 'El título es obligatorio.' }
  if (!payload.assignedToUserId) return { error: 'Debes elegir un responsable.' }

  const { data, error } = await supabase
    .from('assigned_tasks')
    .insert({
      title,
      description: payload.description?.trim() || null,
      client_ref: payload.clientRef?.trim() || null,
      assigned_to_user_id: payload.assignedToUserId,
      created_by_user_id: user.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/tareas')
  return { success: true, taskId: data.id }
}

// ── Editar detalles (admin/supervisor) ───────────────────────────────────────

export async function editTask(
  taskId: string,
  payload: { title?: string; description?: string | null; clientRef?: string | null },
): Promise<{ success: true } | { error: string }> {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()
  await assertAdminOrSupervisor(supabase, user.id)

  const update: {
    title?: string
    description?: string | null
    client_ref?: string | null
  } = {}
  if (payload.title !== undefined) {
    const t = payload.title.trim()
    if (!t) return { error: 'El título no puede quedar vacío.' }
    update.title = t
  }
  if (payload.description !== undefined) update.description = payload.description?.trim() || null
  if (payload.clientRef !== undefined) update.client_ref = payload.clientRef?.trim() || null

  const { error } = await supabase.from('assigned_tasks').update(update).eq('id', taskId)
  if (error) return { error: error.message }
  revalidatePath('/tareas')
  return { success: true }
}

// ── Reasignar (admin/supervisor) ─────────────────────────────────────────────

export async function reassignTask(
  taskId: string,
  newAssigneeUserId: string,
): Promise<{ success: true } | { error: string }> {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()
  await assertAdminOrSupervisor(supabase, user.id)

  if (!newAssigneeUserId) return { error: 'Debes elegir un responsable.' }

  // No reasignar con un timer corriendo: el responsable actual perdería el slot.
  const admin = createAdminClient()
  const { data: activeOnTask } = await admin
    .from('time_entries')
    .select('id')
    .eq('task_id', taskId)
    .is('ended_at', null)
    .maybeSingle()
  if (activeOnTask) {
    return { error: 'La tarea tiene un timer activo. Pídele a la persona que lo detenga antes de reasignar.' }
  }

  const { error } = await supabase
    .from('assigned_tasks')
    .update({ assigned_to_user_id: newAssigneeUserId })
    .eq('id', taskId)
  if (error) return { error: error.message }
  revalidatePath('/tareas')
  return { success: true }
}

// ── Cancelar / archivar (admin/supervisor) ───────────────────────────────────

export async function cancelTask(
  taskId: string,
): Promise<{ success: true } | { error: string }> {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()
  await assertAdminOrSupervisor(supabase, user.id)

  const { data: task } = await supabase
    .from('assigned_tasks')
    .select('status')
    .eq('id', taskId)
    .maybeSingle()
  if (!task) return { error: 'Tarea no encontrada.' }
  if (task.status === 'done') return { error: 'No se puede cancelar una tarea ya finalizada.' }
  if (task.status === 'cancelled') return { error: 'La tarea ya está cancelada.' }

  // Cerrar el timer activo (si lo hay) para no dejarlo colgando; el tiempo ya
  // registrado se conserva y cuenta como productividad de quien lo trabajó.
  const admin = createAdminClient()
  await closeActiveTimerOnTask(admin, taskId)

  const { error } = await supabase
    .from('assigned_tasks')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', taskId)
  if (error) return { error: error.message }
  revalidatePath('/tareas')
  revalidatePath('/tiempo')
  return { success: true }
}

// ── Iniciar timer de la tarea (responsable) ──────────────────────────────────

export async function startTaskTimer(
  taskId: string,
): Promise<{ success: true; entryId: string } | { error: string }> {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()

  const { data: task } = await supabase
    .from('assigned_tasks')
    .select('id, title, status, assigned_to_user_id')
    .eq('id', taskId)
    .maybeSingle()
  if (!task) return { error: 'Tarea no encontrada.' }
  if (task.assigned_to_user_id !== user.id) return { error: 'Esta tarea no está asignada a ti.' }
  if (task.status === 'done') return { error: 'La tarea ya está finalizada.' }
  if (task.status === 'cancelled') return { error: 'La tarea fue cancelada.' }

  // Defensa contra entradas huérfanas (crashes / cierres fallidos).
  await supabase.rpc('close_orphan_time_entries', { p_user_id: user.id, p_older_than_hours: 12 })

  const active = await getActiveEntry(supabase, user.id)
  if (active) return { error: 'Ya tienes una entrada activa. Detén el timer actual primero.' }

  const { data: activeShift } = await supabase
    .from('work_sessions')
    .select('id')
    .eq('user_id', user.id)
    .is('ended_at', null)
    .maybeSingle()
  if (!activeShift) return { error: 'Inicia tu jornada laboral antes de registrar tiempo.' }

  const startedAt = new Date()
  const overlap = await findOverlappingEntry(supabase, user.id, startedAt, null)
  if (overlap) return { error: overlapErrorMsg(overlap) }

  const { data, error } = await supabase
    .from('time_entries')
    .insert({
      user_id: user.id,
      entry_type: 'task',
      task_id: taskId,
      phase: 'task',
      title: task.title,
      started_at: startedAt.toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    // 23505 = unique_violation contra time_entries_one_active_per_user (race).
    if (error.code === '23505') {
      return { error: 'Ya tienes un timer activo (quizás en otra pestaña). Detenlo primero.' }
    }
    return { error: error.message }
  }

  // Pasar la tarea a "en progreso" si era la primera vez. Service role porque el
  // operador no tiene UPDATE sobre assigned_tasks (ver RLS 0116).
  if (task.status === 'pending') {
    const admin = createAdminClient()
    await admin
      .from('assigned_tasks')
      .update({ status: 'in_progress', started_at: startedAt.toISOString() })
      .eq('id', taskId)
  }

  revalidatePath('/tareas')
  revalidatePath('/tiempo')
  return { success: true, entryId: data.id }
}

// ── Marcar finalizada (responsable) ──────────────────────────────────────────

export async function markTaskDone(
  taskId: string,
): Promise<{ success: true } | { error: string }> {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()

  const { data: task } = await supabase
    .from('assigned_tasks')
    .select('id, status, assigned_to_user_id')
    .eq('id', taskId)
    .maybeSingle()
  if (!task) return { error: 'Tarea no encontrada.' }
  if (task.assigned_to_user_id !== user.id) return { error: 'Esta tarea no está asignada a ti.' }
  if (task.status === 'done') return { error: 'La tarea ya está finalizada.' }
  if (task.status === 'cancelled') return { error: 'La tarea fue cancelada.' }

  // Detener el timer activo de esta tarea (si lo hay) antes de cerrarla.
  const admin = createAdminClient()
  await closeActiveTimerOnTask(admin, taskId)

  const { error } = await admin
    .from('assigned_tasks')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', taskId)
  if (error) return { error: error.message }

  revalidatePath('/tareas')
  revalidatePath('/tiempo')
  return { success: true }
}
