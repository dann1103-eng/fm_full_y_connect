'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireUser } from '@/lib/auth/require-user'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import type { DevRequestWithNotes, DevRequestStatus, DevRequestNote } from '@/types/db'

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function assertCanRequestDev(userId: string, admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin.from('users').select('can_request_dev').eq('id', userId).single()
  if (!data?.can_request_dev) throw new Error('Sin acceso')
}

async function findOtherUser(currentUserId: string, admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin
    .from('users')
    .select('id')
    .eq('can_request_dev', true)
    .neq('id', currentUserId)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

// ─── Crear solicitud ──────────────────────────────────────────────────────────

export async function createDevRequest(data: {
  title: string
  description: string
  compensation_method: string
}): Promise<{ ok: true } | { error: string }> {
  const { userId } = await requireUser()
  const admin = createAdminClient()

  await assertCanRequestDev(userId, admin).catch(() => null)
  const { data: me } = await admin.from('users').select('can_request_dev').eq('id', userId).single()
  if (!me?.can_request_dev) return { error: 'Sin acceso para enviar solicitudes' }

  const targetId = await findOtherUser(userId, admin)
  if (!targetId) return { error: 'No se encontró el otro usuario de Solicitudes Especiales' }

  const title = data.title.trim()
  const description = data.description.trim()
  const compensation_method = data.compensation_method.trim()
  if (!title || !description || !compensation_method) {
    return { error: 'Todos los campos son obligatorios' }
  }

  const { error } = await admin.from('dev_requests').insert({
    title,
    description,
    compensation_method,
    created_by: userId,
    target_user_id: targetId,
    status: 'pending',
  })

  if (error) return { error: 'No se pudo enviar la solicitud' }
  revalidatePath('/solicitudes-dev')
  return { ok: true }
}

// ─── Listar solicitudes enriquecidas con notas ────────────────────────────────

export async function listDevRequestsWithNotes(): Promise<{
  received: DevRequestWithNotes[]
  sent: DevRequestWithNotes[]
}> {
  const ctx = await getEffectiveUser()
  if (!ctx) return { received: [], sent: [] }

  const userId = ctx.appUser.id
  const admin = createAdminClient()

  const { data: me } = await admin.from('users').select('can_request_dev').eq('id', userId).single()
  if (!me?.can_request_dev) return { received: [], sent: [] }

  const { data: requests } = await admin
    .from('dev_requests')
    .select('*')
    .or(`created_by.eq.${userId},target_user_id.eq.${userId}`)
    .order('created_at', { ascending: false })

  if (!requests?.length) return { received: [], sent: [] }

  const requestIds = requests.map(r => r.id)
  const { data: notes } = await admin
    .from('dev_request_notes')
    .select('*')
    .in('request_id', requestIds)
    .order('created_at', { ascending: true })

  const notesMap: Record<string, DevRequestNote[]> = {}
  for (const note of (notes ?? []) as DevRequestNote[]) {
    if (!notesMap[note.request_id]) notesMap[note.request_id] = []
    notesMap[note.request_id].push(note)
  }

  const enriched: DevRequestWithNotes[] = (requests as DevRequestWithNotes[]).map(r => ({
    ...r,
    notes: notesMap[r.id] ?? [],
    is_recipient: r.target_user_id === userId,
  }))

  return {
    received: enriched.filter(r => r.is_recipient),
    sent:     enriched.filter(r => !r.is_recipient),
  }
}

// ─── Actualizar estado (solo el destinatario) ─────────────────────────────────

export async function updateDevRequestStatus(
  requestId: string,
  status: DevRequestStatus,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await getEffectiveUser()
  if (!ctx) return { error: 'No autenticado' }

  const userId = ctx.appUser.id
  const admin = createAdminClient()

  const { data: req } = await admin
    .from('dev_requests')
    .select('target_user_id')
    .eq('id', requestId)
    .maybeSingle()

  if (!req) return { error: 'Solicitud no encontrada' }
  if (req.target_user_id !== userId) return { error: 'Solo el destinatario puede cambiar el estado' }

  const { error } = await admin
    .from('dev_requests')
    .update({ status })
    .eq('id', requestId)

  if (error) return { error: 'No se pudo actualizar el estado' }
  revalidatePath('/solicitudes-dev')
  return { ok: true }
}

// ─── Agregar nota de seguimiento ─────────────────────────────────────────────

export async function addDevRequestNote(
  requestId: string,
  content: string,
): Promise<{ ok: true; note: DevRequestNote } | { error: string }> {
  const ctx = await getEffectiveUser()
  if (!ctx) return { error: 'No autenticado' }

  const userId = ctx.appUser.id
  const admin = createAdminClient()

  const { data: me } = await admin.from('users').select('can_request_dev').eq('id', userId).single()
  if (!me?.can_request_dev) return { error: 'Sin acceso' }

  // Verificar que el usuario está involucrado en esta solicitud
  const { data: req } = await admin
    .from('dev_requests')
    .select('created_by, target_user_id')
    .eq('id', requestId)
    .maybeSingle()

  if (!req) return { error: 'Solicitud no encontrada' }
  if (req.created_by !== userId && req.target_user_id !== userId) {
    return { error: 'No tienes acceso a esta solicitud' }
  }

  const text = content.trim()
  if (!text) return { error: 'La nota no puede estar vacía' }

  const { data: inserted, error } = await admin
    .from('dev_request_notes')
    .insert({ request_id: requestId, content: text, created_by: userId })
    .select('*')
    .single()

  if (error || !inserted) return { error: 'No se pudo guardar la nota' }

  revalidatePath('/solicitudes-dev')
  return { ok: true, note: inserted as DevRequestNote }
}
