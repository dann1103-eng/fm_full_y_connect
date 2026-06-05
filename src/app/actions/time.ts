'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertNotImpersonating } from './impersonation'
import type { AdminCategory, Database } from '@/types/db'

type TimeEntryUpdate = Database['public']['Tables']['time_entries']['Update']

// ── Helpers ────────────────────────────────────────────────────────────────

async function getAuthUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
  return { supabase, user }
}

async function assertAdmin(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase.from('users').select('role').eq('id', userId).single()
  if (data?.role !== 'admin') throw new Error('Sin permisos')
}

async function assertAdminOrSupervisor(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase.from('users').select('role').eq('id', userId).single()
  if (data?.role !== 'admin' && data?.role !== 'supervisor') throw new Error('Sin permisos')
}

/** Returns the active (ended_at IS NULL) entry for a user, or null */
async function getActiveEntry(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .is('ended_at', null)
    .maybeSingle()
  return data
}

/**
 * Busca una time_entry del usuario que se solape con [startedAt, endedAt).
 * Devuelve la primera coincidencia, o null si no hay solapamiento.
 *
 * Definición de overlap (intervalos semi-abiertos):
 *   existing.started_at < new.ended_at
 *   AND (existing.ended_at > new.started_at OR existing.ended_at IS NULL)
 *
 * Para entradas activas (ended_at NULL), se asume que se extienden
 * indefinidamente hacia el futuro, por lo que cualquier nueva entrada
 * que arranque después de la activa se solapa con ella.
 *
 * Si endedAt es null (live timer arrancando), se trata el nuevo intervalo
 * como [startedAt, +infinity) y se busca cualquier existente que termine
 * después de startedAt o esté abierto.
 */
async function findOverlappingEntry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  startedAt: Date,
  endedAt: Date | null,
  excludeEntryId: string | null = null,
) {
  let q = supabase
    .from('time_entries')
    .select('id, title, started_at, ended_at')
    .eq('user_id', userId)

  if (endedAt) {
    q = q.lt('started_at', endedAt.toISOString())
  }
  // existing.ended_at > new.started_at OR existing.ended_at IS NULL
  q = q.or(`ended_at.gt.${startedAt.toISOString()},ended_at.is.null`)
  if (excludeEntryId) q = q.neq('id', excludeEntryId)

  const { data } = await q.limit(1)
  return (data && data.length > 0) ? data[0] : null
}

function formatHm(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function overlapErrorMsg(other: { title: string | null; started_at: string; ended_at: string | null }): string {
  const range = other.ended_at
    ? `${formatHm(other.started_at)} – ${formatHm(other.ended_at)}`
    : `desde ${formatHm(other.started_at)} (activa)`
  const title = other.title?.trim() || 'otra entrada'
  return `Se solapa con "${title}" (${range}). Ajustá los horarios o eliminá la entrada existente.`
}

// ── Start admin clock-in ───────────────────────────────────────────────────

export async function startAdminEntry(category: AdminCategory, notes?: string) {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()

  // Defensa contra entradas huérfanas: cierra automáticamente cualquier
  // time_entry abierta hace > 12 horas. Cubre cierres fallidos por crashes,
  // red caída a mitad de stop, o filas insertadas sin ended_at.
  await supabase.rpc('close_orphan_time_entries', {
    p_user_id: user.id,
    p_older_than_hours: 12,
  })

  const active = await getActiveEntry(supabase, user.id)
  if (active) return { error: 'Ya tienes una entrada activa. Marca salida primero.' }

  // Verificar jornada activa
  const { data: activeShift } = await supabase
    .from('work_sessions')
    .select('id')
    .eq('user_id', user.id)
    .is('ended_at', null)
    .maybeSingle()
  if (!activeShift) return { error: 'Inicia tu jornada laboral antes de registrar tiempo.' }

  // Validar que no haya entradas existentes que cubran este momento
  const startedAt = new Date()
  const overlap = await findOverlappingEntry(supabase, user.id, startedAt, null)
  if (overlap) return { error: overlapErrorMsg(overlap) }

  const { error } = await supabase.from('time_entries').insert({
    user_id: user.id,
    entry_type: 'administrative',
    category,
    phase: 'administrative',
    title: category,
    started_at: startedAt.toISOString(),
    notes: notes?.trim() || null,
  })

  if (error) {
    // 23505 = unique_violation contra time_entries_one_active_per_user.
    // Ocurre si otra pestaña insertó un timer en el gap entre el check y este
    // INSERT (race condition). El índice único es la red de seguridad real.
    if (error.code === '23505') {
      return { error: 'Ya tienes una entrada activa (quizás en otra pestaña). Marca salida primero.' }
    }
    return { error: error.message }
  }
  revalidatePath('/tiempo')
  return { success: true }
}

// ── Update notes on own active entry (no admin gate) ──────────────────────

export async function updateMyActiveNotes(notes: string) {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()
  const active = await getActiveEntry(supabase, user.id)
  if (!active) return { error: 'No hay entrada activa.' }
  const { error } = await supabase
    .from('time_entries')
    .update({ notes: notes.trim() || null })
    .eq('id', active.id)
    .eq('user_id', user.id)
  if (error) return { error: error.message }
  revalidatePath('/tiempo')
  return { success: true }
}

// ── Start requirement timer ────────────────────────────────────────────────

export async function startRequirementTimer(requirementId: string, requirementTitle: string, phase: string) {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()

  // Defensa contra entradas huérfanas: cierra automáticamente cualquier
  // time_entry abierta hace > 12 horas (cierres fallidos / crashes / etc.).
  await supabase.rpc('close_orphan_time_entries', {
    p_user_id: user.id,
    p_older_than_hours: 12,
  })

  const active = await getActiveEntry(supabase, user.id)
  if (active) return { error: 'Ya tienes una entrada activa. Detén el timer actual primero.' }

  // Verificar jornada activa
  const { data: activeShift } = await supabase
    .from('work_sessions')
    .select('id')
    .eq('user_id', user.id)
    .is('ended_at', null)
    .maybeSingle()
  if (!activeShift) return { error: 'Inicia tu jornada laboral antes de registrar tiempo.' }

  // Validar que no haya entradas existentes que cubran este momento
  const startedAt = new Date()
  const overlap = await findOverlappingEntry(supabase, user.id, startedAt, null)
  if (overlap) return { error: overlapErrorMsg(overlap) }

  const { data, error } = await supabase.from('time_entries').insert({
    user_id: user.id,
    entry_type: 'requirement',
    requirement_id: requirementId,
    phase,
    title: requirementTitle,
    started_at: startedAt.toISOString(),
  }).select('id').single()

  if (error) {
    // 23505 = unique_violation contra time_entries_one_active_per_user (race
    // entre dos pestañas). El índice único es la red de seguridad real.
    if (error.code === '23505') {
      return { error: 'Ya tienes un timer activo (quizás en otra pestaña). Detenlo primero.' }
    }
    return { error: error.message }
  }
  revalidatePath('/tiempo')
  return { success: true, entryId: data.id }
}

// ── Stop active entry ──────────────────────────────────────────────────────

export async function stopActiveEntry() {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()

  const active = await getActiveEntry(supabase, user.id)
  if (!active) return { error: 'No hay entrada activa.' }

  const endedAt = new Date()
  const startedAt = new Date(active.started_at)
  const durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)

  const { error } = await supabase
    .from('time_entries')
    .update({ ended_at: endedAt.toISOString(), duration_seconds: durationSeconds })
    .eq('id', active.id)

  if (error) return { error: error.message }
  revalidatePath('/tiempo')
  return { success: true, durationSeconds }
}

/**
 * Cierra TODOS los time_entries abiertos del usuario (sin `assertNotImpersonating`
 * para que funcione desde el force-logout del StillOnlineDialog).
 */
export async function stopAllActiveEntries(): Promise<{ ok: true; count: number } | { error: string }> {
  const { supabase, user } = await getAuthUser()
  const now = new Date()

  const { data: actives } = await supabase
    .from('time_entries')
    .select('id, started_at')
    .eq('user_id', user.id)
    .is('ended_at', null)

  if (!actives || actives.length === 0) return { ok: true, count: 0 }

  for (const entry of actives) {
    const durationSeconds = Math.round(
      (now.getTime() - new Date(entry.started_at).getTime()) / 1000
    )
    await supabase
      .from('time_entries')
      .update({ ended_at: now.toISOString(), duration_seconds: durationSeconds })
      .eq('id', entry.id)
  }

  revalidatePath('/tiempo')
  return { ok: true, count: actives.length }
}

// ── Get active entry (for UI polling) ─────────────────────────────────────

export async function getMyActiveEntry() {
  const { supabase, user } = await getAuthUser()
  return getActiveEntry(supabase, user.id)
}

// ── Admin: add entry manually ──────────────────────────────────────────────

export async function adminAddEntry(payload: {
  targetUserId: string
  entryType: 'requirement' | 'administrative'
  category?: AdminCategory
  requirementId?: string
  phase?: string
  title: string
  startedAt: string
  endedAt: string
}) {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()
  await assertAdminOrSupervisor(supabase, user.id)

  const startedAt = new Date(payload.startedAt)
  const endedAt = new Date(payload.endedAt)
  const durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)

  if (durationSeconds <= 0) return { error: 'La hora de fin debe ser posterior a la de inicio.' }
  // Bloquear endedAt en el futuro (con 1 min de buffer por desfase de reloj
  // entre cliente y servidor). Sin esta validación, una entrada con
  // ended_at futuro infla productive_seconds con tiempo aún no transcurrido.
  if (endedAt.getTime() > new Date().getTime() + 60_000) {
    return { error: 'La hora de fin no puede ser en el futuro.' }
  }
  // Bloquear solapamiento con entradas existentes del mismo usuario
  const overlap = await findOverlappingEntry(supabase, payload.targetUserId, startedAt, endedAt)
  if (overlap) return { error: overlapErrorMsg(overlap) }

  const { error } = await supabase.from('time_entries').insert({
    user_id: payload.targetUserId,
    entry_type: payload.entryType,
    category: payload.category ?? null,
    requirement_id: payload.requirementId ?? null,
    phase: payload.phase ?? payload.entryType,
    title: payload.title,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    duration_seconds: durationSeconds,
  })

  if (error) return { error: error.message }
  revalidatePath('/tiempo')
  return { success: true }
}

// ── Admin: edit entry ──────────────────────────────────────────────────────

export async function adminEditEntry(entryId: string, payload: {
  title?: string
  startedAt?: string
  endedAt?: string
  category?: AdminCategory | null
  notes?: string | null
}) {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()
  await assertAdminOrSupervisor(supabase, user.id)

  const update: TimeEntryUpdate = {}
  if (payload.title !== undefined) update.title = payload.title
  if (payload.category !== undefined) update.category = payload.category ?? null
  if (payload.notes !== undefined) update.notes = payload.notes

  if (payload.startedAt && payload.endedAt) {
    const start = new Date(payload.startedAt)
    const end = new Date(payload.endedAt)
    const dur = Math.round((end.getTime() - start.getTime()) / 1000)
    if (dur <= 0) return { error: 'La hora de fin debe ser posterior a la de inicio.' }
    if (end.getTime() > new Date().getTime() + 60_000) {
      return { error: 'La hora de fin no puede ser en el futuro.' }
    }
    // Validar overlap excluyendo la entrada que estamos editando.
    // Necesitamos saber a qué usuario pertenece para acotar la búsqueda.
    const { data: existingEntry } = await supabase
      .from('time_entries')
      .select('user_id')
      .eq('id', entryId)
      .single()
    if (existingEntry) {
      const overlap = await findOverlappingEntry(supabase, existingEntry.user_id, start, end, entryId)
      if (overlap) return { error: overlapErrorMsg(overlap) }
    }
    update.started_at = start.toISOString()
    update.ended_at = end.toISOString()
    update.duration_seconds = dur
  }

  const { error } = await supabase.from('time_entries').update(update).eq('id', entryId)
  if (error) return { error: error.message }
  revalidatePath('/tiempo')
  return { success: true }
}

// ── Admin: delete entry ────────────────────────────────────────────────────

export async function adminDeleteEntry(entryId: string) {
  await assertNotImpersonating()
  const { supabase, user } = await getAuthUser()
  await assertAdminOrSupervisor(supabase, user.id)

  const { error } = await supabase.from('time_entries').delete().eq('id', entryId)
  if (error) return { error: error.message }
  revalidatePath('/tiempo')
  return { success: true }
}
