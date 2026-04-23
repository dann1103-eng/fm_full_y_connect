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

export async function inviteClientUser(params: {
  clientId: string
  email: string
  fullName?: string
}) {
  const { clientId, email, fullName } = params
  const clean = email.trim().toLowerCase()
  if (!clean || !clean.includes('@')) throw new Error('Email inválido')

  await requireAdmin()
  const admin = createAdminClient()

  // 1) ¿Ya existe ese email en public.users?
  const { data: existing } = await admin
    .from('users')
    .select('id, role')
    .eq('email', clean)
    .maybeSingle()

  let userId: string
  if (existing) {
    userId = existing.id
    if (existing.role !== 'client') {
      throw new Error(
        `${clean} ya tiene cuenta como ${existing.role}. No se puede convertir en cliente.`
      )
    }
  } else {
    // 2) Invitar por email vía Supabase Auth.
    const { data, error } = await admin.auth.admin.inviteUserByEmail(clean, {
      data: { role: 'client', full_name: fullName ?? null },
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/portal/dashboard`,
    })
    if (error || !data.user) {
      throw new Error(`No se pudo enviar invitación: ${error?.message ?? 'desconocido'}`)
    }
    userId = data.user.id

    // 3) Registrar en public.users con role='client'.
    const { error: upsertErr } = await admin.from('users').upsert({
      id: userId,
      email: clean,
      full_name: fullName ?? '',
      role: 'client',
    })
    if (upsertErr) {
      throw new Error(`No se pudo registrar el usuario: ${upsertErr.message}`)
    }
  }

  // 4) Vincular al cliente.
  const { error: linkErr } = await admin
    .from('client_users')
    .upsert(
      { user_id: userId, client_id: clientId, role: 'owner' },
      { onConflict: 'user_id,client_id' }
    )
  if (linkErr) throw new Error(`No se pudo vincular al cliente: ${linkErr.message}`)

  revalidatePath(`/clients/${clientId}`)
}

export async function revokeClientUser(params: { clientId: string; userId: string }) {
  await requireAdmin()
  const admin = createAdminClient()

  const { error } = await admin
    .from('client_users')
    .delete()
    .eq('client_id', params.clientId)
    .eq('user_id', params.userId)
  if (error) throw new Error(`No se pudo revocar acceso: ${error.message}`)

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
