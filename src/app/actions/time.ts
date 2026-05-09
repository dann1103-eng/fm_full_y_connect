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

  const { error } = await supabase.from('time_entries').insert({
    user_id: user.id,
    entry_type: 'administrative',
    category,
    phase: 'administrative',
    title: category,
    started_at: new Date().toISOString(),
    notes: notes?.trim() || null,
  })

  if (error) return { error: error.message }
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

  const { data, error } = await supabase.from('time_entries').insert({
    user_id: user.id,
    entry_type: 'requirement',
    requirement_id: requirementId,
    phase,
    title: requirementTitle,
    started_at: new Date().toISOString(),
  }).select('id').single()

  if (error) return { error: error.message }
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
