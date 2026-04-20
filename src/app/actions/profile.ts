'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function updateMyProfile(payload: { fullName?: string; avatarUrl?: string }) {
  try {
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
