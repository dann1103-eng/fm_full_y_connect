'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import type { UserRole } from '@/types/db'

export async function updateUserRole(targetUserId: string, role: UserRole): Promise<{ error: string | null }> {
  try {
    if (!targetUserId) return { error: 'ID de usuario requerido' }

    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'No autenticado' }

    const { data: appUser } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()
    if (appUser?.role !== 'admin') return { error: 'Solo admins pueden cambiar roles de usuario' }

    const { data: targetUser } = await supabase
      .from('users')
      .select('role')
      .eq('id', targetUserId)
      .single()

    if (!targetUser) return { error: 'Usuario no encontrado' }

    if ((role === 'operator' || role === 'supervisor') && targetUser.role === 'admin') {
      const { count } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'admin')
      if ((count ?? 0) <= 1) {
        return { error: 'No se puede degradar al único admin del sistema' }
      }
    }

    const adminClient = createAdminClient()
    const { error: updateError } = await adminClient
      .from('users')
      .update({ role })
      .eq('id', targetUserId)

    if (updateError) return { error: 'Error al actualizar el rol del usuario' }

    revalidatePath('/users')
    return { error: null }
  } catch (e) {
    console.error('updateUserRole failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}
