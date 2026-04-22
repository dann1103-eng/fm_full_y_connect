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
  try {
    await assertAdmin()

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { error: 'Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno.' }
    }

    const admin = createAdminClient()

    const { data, error } = await admin.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
      email_confirm: true,
      user_metadata: { full_name: payload.fullName },
    })

    if (error) return { error: error.message }
    if (!data.user) return { error: 'No se recibió el usuario creado.' }

    const { error: insertError } = await admin.from('users').upsert({
      id: data.user.id,
      email: payload.email,
      full_name: payload.fullName,
      role: payload.role,
    })

    if (insertError) return { error: insertError.message }

    revalidatePath('/users')
    return { success: true }
  } catch (e) {
    console.error('createUser failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido al crear usuario' }
  }
}

export async function updateUserProfile(payload: {
  userId: string
  fullName?: string
  avatarUrl?: string | null
  email?: string
}) {
  try {
    await assertAdmin()

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { error: 'Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno.' }
    }

    const admin = createAdminClient()

    const profileUpdate: { full_name?: string; avatar_url?: string | null; email?: string } = {}
    if (payload.fullName !== undefined) profileUpdate.full_name = payload.fullName
    if (payload.avatarUrl !== undefined) profileUpdate.avatar_url = payload.avatarUrl
    if (payload.email !== undefined) profileUpdate.email = payload.email

    if (Object.keys(profileUpdate).length === 0) {
      return { error: 'Sin cambios para guardar.' }
    }

    if (payload.email !== undefined) {
      const { error: authError } = await admin.auth.admin.updateUserById(payload.userId, {
        email: payload.email,
      })
      if (authError) return { error: authError.message }
    }

    if (payload.fullName !== undefined) {
      await admin.auth.admin.updateUserById(payload.userId, {
        user_metadata: { full_name: payload.fullName },
      })
    }

    const { error } = await admin.from('users').update(profileUpdate).eq('id', payload.userId)
    if (error) return { error: error.message }

    revalidatePath('/users')
    return { success: true }
  } catch (e) {
    console.error('updateUserProfile failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido al actualizar perfil' }
  }
}

export async function adminChangeUserPassword(payload: {
  userId: string
  newPassword: string
}) {
  try {
    await assertAdmin()

    if (payload.newPassword.length < 8) {
      return { error: 'La contraseña debe tener al menos 8 caracteres.' }
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { error: 'Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno.' }
    }

    const admin = createAdminClient()

    const { error } = await admin.auth.admin.updateUserById(payload.userId, {
      password: payload.newPassword,
    })
    if (error) return { error: error.message }

    return { success: true }
  } catch (e) {
    console.error('adminChangeUserPassword failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido al cambiar contraseña' }
  }
}

export async function deleteUser(targetUserId: string) {
  try {
    await assertAdmin()

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { error: 'Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno.' }
    }

    const admin = createAdminClient()

    const { error: authError } = await admin.auth.admin.deleteUser(targetUserId)
    if (authError) return { error: authError.message }

    await admin.from('users').delete().eq('id', targetUserId)

    revalidatePath('/users')
    return { success: true }
  } catch (e) {
    console.error('deleteUser failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido al eliminar usuario' }
  }
}
