'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { IMPERSONATE_COOKIE } from '@/lib/auth/effective-user'

/**
 * Inicia el modo espectador del admin sobre `targetUserId`.
 * - Verifica que el caller real sea admin.
 * - Verifica que el target exista y NO sea otro admin.
 * - Inserta un log de auditoría.
 * - Setea la cookie httpOnly y redirige al destino apropiado.
 *
 * Lanza Error si la validación falla (los gates de UI deben prevenir esos casos).
 */
export async function startImpersonation(targetUserId: string): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')

  const { data: me } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (me?.role !== 'admin') throw new Error('Solo admins pueden suplantar usuarios.')

  if (targetUserId === user.id) {
    throw new Error('No puedes suplantarte a ti mismo.')
  }

  const admin = createAdminClient()
  const { data: target } = await admin
    .from('users')
    .select('id, role')
    .eq('id', targetUserId)
    .single()
  if (!target) throw new Error('Usuario no encontrado.')
  if (target.role === 'admin') {
    throw new Error('No se puede suplantar a otro admin.')
  }

  // Audit log
  await admin.from('impersonation_logs').insert({
    admin_user_id: user.id,
    target_user_id: targetUserId,
  })

  const cookieStore = await cookies()
  cookieStore.set(IMPERSONATE_COOKIE, targetUserId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })

  if (target.role === 'client') redirect('/portal/dashboard')
  redirect('/dashboard')
}

/**
 * Termina el modo espectador. Cierra el log abierto correspondiente.
 */
export async function stopImpersonation(): Promise<never> {
  const cookieStore = await cookies()
  const wasImpersonating = cookieStore.get(IMPERSONATE_COOKIE)?.value
  cookieStore.delete(IMPERSONATE_COOKIE)

  if (wasImpersonating) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const admin = createAdminClient()
      await admin
        .from('impersonation_logs')
        .update({ ended_at: new Date().toISOString() })
        .eq('admin_user_id', user.id)
        .eq('target_user_id', wasImpersonating)
        .is('ended_at', null)
    }
  }
  redirect('/users')
}

/**
 * Helper de defensa-en-profundidad: lanza si la cookie de suplantación
 * está set. Llamar al inicio de toda server action de MUTACIÓN.
 *
 * No se llama desde server actions puramente de lectura.
 */
// react-doctor-disable-next-line react-doctor/server-auth-actions
export async function assertNotImpersonating(): Promise<void> {
  const cookieStore = await cookies()
  if (cookieStore.get(IMPERSONATE_COOKIE)?.value) {
    throw new Error('Modo espectador: las mutaciones están deshabilitadas.')
  }
}
