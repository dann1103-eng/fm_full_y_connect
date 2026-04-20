'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
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
  const { supabase, user } = await getAuthUser()

  const active = await getActiveEntry(supabase, user.id)
  if (active) return { error: 'Ya tienes una entrada activa. Marca salida primero.' }

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
  const { supabase, user } = await getAuthUser()

  const active = await getActiveEntry(supabase, user.id)
  if (active) return { error: 'Ya tienes una entrada activa. Detén el timer actual primero.' }

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
  const { supabase, user } = await getAuthUser()
  await assertAdmin(supabase, user.id)

  const startedAt = new Date(payload.startedAt)
  const endedAt = new Date(payload.endedAt)
  const durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)

  if (durationSeconds <= 0) return { error: 'La hora de fin debe ser posterior a la de inicio.' }

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
  const { supabase, user } = await getAuthUser()
  await assertAdmin(supabase, user.id)

  const update: TimeEntryUpdate = {}
  if (payload.title !== undefined) update.title = payload.title
  if (payload.category !== undefined) update.category = payload.category ?? null
  if (payload.notes !== undefined) update.notes = payload.notes

  if (payload.startedAt && payload.endedAt) {
    const start = new Date(payload.startedAt)
    const end = new Date(payload.endedAt)
    const dur = Math.round((end.getTime() - start.getTime()) / 1000)
    if (dur <= 0) return { error: 'La hora de fin debe ser posterior a la de inicio.' }
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
  const { supabase, user } = await getAuthUser()
  await assertAdmin(supabase, user.id)

  const { error } = await supabase.from('time_entries').delete().eq('id', entryId)
  if (error) return { error: error.message }
  revalidatePath('/tiempo')
  return { success: true }
}
