'use server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

/**
 * Marca/desmarca un usuario como "asignado por defecto" al crear requerimientos.
 * Solo admins pueden cambiar este flag.
 */
export async function updateUserDefaultAssignee(
  targetUserId: string,
  defaultAssignee: boolean
): Promise<{ error: string | null }> {
  try {
    if (!targetUserId) return { error: 'ID de usuario requerido' }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { error: 'No autenticado' }

    const { data: appUser } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()
    if (appUser?.role !== 'admin') {
      return { error: 'Solo admins pueden cambiar la asignación por defecto' }
    }

    const adminClient = createAdminClient()
    const { error: updateError } = await adminClient
      .from('users')
      .update({ default_assignee: defaultAssignee })
      .eq('id', targetUserId)

    if (updateError) return { error: 'Error al actualizar la asignación por defecto' }

    revalidatePath('/users')
    return { error: null }
  } catch (e) {
    console.error('updateUserDefaultAssignee failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}
