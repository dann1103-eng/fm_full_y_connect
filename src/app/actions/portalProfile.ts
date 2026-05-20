'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from './impersonation'

/**
 * Persiste la URL del avatar del usuario actual (cliente del portal).
 * El upload físico al bucket `user-avatars` lo hace el componente cliente
 * vía `uploadUserAvatar`; aquí solo guardamos el URL en `users.avatar_url`.
 * Usamos adminClient para el UPDATE porque las policies RLS de la tabla users
 * pueden no cubrir a usuarios con role='client'.
 */
export async function setClientAvatarUrl(
  avatarUrl: string | null,
): Promise<{ ok: true } | { error: string }> {
  await assertNotImpersonating()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const admin = createAdminClient()

  const { data: appUser } = await admin
    .from('users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'client') {
    return { error: 'Esta acción es solo para usuarios del portal del cliente' }
  }

  const { error } = await admin
    .from('users')
    .update({ avatar_url: avatarUrl })
    .eq('id', user.id)
  if (error) return { error: error.message }

  revalidatePath('/portal/config')
  revalidatePath('/portal/dashboard')
  return { ok: true }
}
