'use server'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { UserRole } from '@/types/db'

export async function updateUserRole(targetUserId: string, role: UserRole): Promise<void> {
  if (!targetUserId) throw new Error('ID de usuario requerido')

  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')

  const { data: appUser } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (appUser?.role !== 'admin') throw new Error('Solo admins pueden cambiar roles de usuario')

  // Fetch target user (validates existence + gets current role for last-admin guard)
  const { data: targetUser } = await supabase
    .from('users')
    .select('role')
    .eq('id', targetUserId)
    .single()

  if (!targetUser) throw new Error('Usuario no encontrado')

  // Guard: prevent downgrading the last admin
  if ((role === 'operator' || role === 'supervisor') && targetUser.role === 'admin') {
    const { count } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('role', 'admin')
    if ((count ?? 0) <= 1) {
      throw new Error('No se puede degradar al único admin del sistema')
    }
  }

  // Update the role
  const { error: updateError } = await supabase
    .from('users')
    .update({ role })
    .eq('id', targetUserId)

  if (updateError) throw new Error('Error al actualizar el rol del usuario')

  revalidatePath('/users')
}
