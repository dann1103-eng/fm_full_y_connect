'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireUser } from '@/lib/auth/require-user'
import type { DevRequest, DevRequestStatus } from '@/types/db'

// ─── Crear solicitud ──────────────────────────────────────────────────────────

export async function createDevRequest(data: {
  title: string
  description: string
  compensation_method: string
}): Promise<{ ok: true } | { error: string }> {
  const { supabase, userId } = await requireUser()

  const { data: appUser } = await supabase
    .from('users')
    .select('can_request_dev')
    .eq('id', userId)
    .single()

  if (!appUser?.can_request_dev) {
    return { error: 'Sin acceso para enviar solicitudes' }
  }

  const title = data.title.trim()
  const description = data.description.trim()
  const compensation_method = data.compensation_method.trim()

  if (!title || !description || !compensation_method) {
    return { error: 'Todos los campos son obligatorios' }
  }

  const admin = createAdminClient()
  const { error } = await admin.from('dev_requests').insert({
    title,
    description,
    compensation_method,
    created_by: userId,
    status: 'pending',
  })

  if (error) return { error: 'No se pudo enviar la solicitud' }

  revalidatePath('/solicitudes-dev')
  return { ok: true }
}

// ─── Listar solicitudes ───────────────────────────────────────────────────────

export async function listDevRequests(): Promise<DevRequest[]> {
  const { supabase, userId, role } = await requireUser({ allowImpersonation: true })

  if (role !== 'admin') {
    // El requester solo ve las suyas
    const { data: appUser } = await supabase
      .from('users')
      .select('can_request_dev')
      .eq('id', userId)
      .single()

    if (!appUser?.can_request_dev) return []

    const { data } = await supabase
      .from('dev_requests')
      .select('*')
      .eq('created_by', userId)
      .order('created_at', { ascending: false })

    return (data ?? []) as DevRequest[]
  }

  // Admin ve todo
  const admin = createAdminClient()
  const { data } = await admin
    .from('dev_requests')
    .select('*')
    .order('created_at', { ascending: false })

  return (data ?? []) as DevRequest[]
}

// ─── Actualizar estado (solo admin) ──────────────────────────────────────────

export async function updateDevRequestStatus(
  id: string,
  status: DevRequestStatus,
): Promise<{ ok: true } | { error: string }> {
  const { role } = await requireUser()
  if (role !== 'admin') return { error: 'Sin permisos' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('dev_requests')
    .update({ status })
    .eq('id', id)

  if (error) return { error: 'No se pudo actualizar el estado' }

  revalidatePath('/solicitudes-dev')
  return { ok: true }
}
