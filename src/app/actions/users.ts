'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { UserRole } from '@/types/db'

async function assertAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (data?.role !== 'admin') throw new Error('Sin permisos')
}

export async function createUser(payload: {
  email: string
  password: string
  fullName: string
  role: UserRole
}) {
  await assertAdmin()

  const admin = createAdminClient()

  const { data, error } = await admin.auth.admin.createUser({
    email: payload.email,
    password: payload.password,
    email_confirm: true,
    user_metadata: { full_name: payload.fullName },
  })

  if (error) return { error: error.message }

  // Insert into public.users (trigger may not exist)
  const { error: insertError } = await admin.from('users').upsert({
    id: data.user.id,
    email: payload.email,
    full_name: payload.fullName,
    role: payload.role,
  })

  if (insertError) return { error: insertError.message }

  revalidatePath('/users')
  return { success: true }
}

export async function deleteUser(targetUserId: string) {
  await assertAdmin()

  const admin = createAdminClient()

  const { error: authError } = await admin.auth.admin.deleteUser(targetUserId)
  if (authError) return { error: authError.message }

  await admin.from('users').delete().eq('id', targetUserId)

  revalidatePath('/users')
  return { success: true }
}
