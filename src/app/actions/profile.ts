'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { assertNotImpersonating } from './impersonation'

export async function changeMyPassword(newPassword: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!newPassword || newPassword.length < 8) {
      return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' }
    }
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: 'Sesión no encontrada. Cierra sesión e ingresa nuevamente.' }

    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { ok: false, error: error.message }

    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Error al actualizar la contraseña.' }
  }
}

export async function updateMyProfile(payload: { fullName?: string; avatarUrl?: string }) {
  try {
    await assertNotImpersonating()
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No autenticado' }

    const update: { full_name?: string; avatar_url?: string } = {}
    if (payload.fullName !== undefined) update.full_name = payload.fullName.trim() || undefined
    if (payload.avatarUrl !== undefined) update.avatar_url = payload.avatarUrl

    if (Object.keys(update).length === 0) return { success: true }

    const { error } = await supabase.from('users').update(update).eq('id', user.id)
    if (error) return { error: error.message }

    revalidatePath('/profile')
    revalidatePath('/', 'layout')
    return { success: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}
