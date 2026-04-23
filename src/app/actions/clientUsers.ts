'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
  const { data: appUser } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (appUser?.role !== 'admin') {
    throw new Error('Solo admins pueden gestionar accesos de portal')
  }
  return { supabase, adminUserId: user.id }
}

export async function createClientUser(params: {
  clientId: string
  email: string
  password: string
  fullName?: string
}): Promise<{ userId: string }> {
  const { clientId, email, password, fullName } = params
  const clean = email.trim().toLowerCase()
  if (!clean || !clean.includes('@')) throw new Error('Email inválido')
  if (!password || password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres')

  await requireAdmin()
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('users')
    .select('id, role')
    .eq('email', clean)
    .maybeSingle()

  let userId: string

  if (existing) {
    if (existing.role !== 'client') {
      throw new Error(
        `${clean} ya tiene cuenta como ${existing.role}. No se puede reutilizar este correo para un cliente.`
      )
    }
    userId = existing.id
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password })
    if (updErr) throw new Error(`No se pudo actualizar la contraseña: ${updErr.message}`)
    if (fullName) {
      await admin.from('users').update({ full_name: fullName }).eq('id', userId)
    }
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: clean,
      password,
      email_confirm: true,
      user_metadata: { role: 'client', full_name: fullName ?? null },
    })
    if (error || !data.user) {
      throw new Error(`No se pudo crear el usuario: ${error?.message ?? 'desconocido'}`)
    }
    userId = data.user.id

    const { error: upsertErr } = await admin.from('users').upsert({
      id: userId,
      email: clean,
      full_name: fullName ?? '',
      role: 'client',
    })
    if (upsertErr) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined)
      throw new Error(`No se pudo registrar el usuario: ${upsertErr.message}`)
    }
  }

  const { error: linkErr } = await admin
    .from('client_users')
    .upsert(
      { user_id: userId, client_id: clientId, role: 'owner' },
      { onConflict: 'user_id,client_id' }
    )
  if (linkErr) throw new Error(`No se pudo vincular al cliente: ${linkErr.message}`)

  revalidatePath(`/clients/${clientId}`)
  return { userId }
}

export async function revokeClientUser(params: { clientId: string; userId: string }) {
  await requireAdmin()
  const admin = createAdminClient()

  const { data: target } = await admin
    .from('users')
    .select('role')
    .eq('id', params.userId)
    .maybeSingle()
  if (!target) throw new Error('Usuario no encontrado')
  if (target.role !== 'client') {
    throw new Error('Solo se pueden revocar accesos de clientes')
  }

  const { error: unlinkErr } = await admin
    .from('client_users')
    .delete()
    .eq('client_id', params.clientId)
    .eq('user_id', params.userId)
  if (unlinkErr) throw new Error(`No se pudo desvincular del cliente: ${unlinkErr.message}`)

  const { data: remaining } = await admin
    .from('client_users')
    .select('id')
    .eq('user_id', params.userId)
    .limit(1)

  if (!remaining || remaining.length === 0) {
    const { error: delPubErr } = await admin.from('users').delete().eq('id', params.userId)
    if (delPubErr) throw new Error(`No se pudo eliminar el registro público: ${delPubErr.message}`)

    const { error: delAuthErr } = await admin.auth.admin.deleteUser(params.userId)
    if (delAuthErr) throw new Error(`No se pudo eliminar la cuenta: ${delAuthErr.message}`)
  }

  revalidatePath(`/clients/${params.clientId}`)
}

export async function listClientUsers(clientId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('client_users')
    .select('id, user_id, role, created_at, users:users!inner(id, full_name, email, role)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}
