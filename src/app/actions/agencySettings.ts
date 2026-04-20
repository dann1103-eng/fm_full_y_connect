'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

/** Guarda la URL del logo de la agencia en app_settings. Solo admins. */
export async function updateAgencyLogoUrl(
  url: string
): Promise<{ error?: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: appUser } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (appUser?.role !== 'admin') return { error: 'Solo admins pueden cambiar el logo.' }

  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: 'agency_logo_url', value: url, updated_at: new Date().toISOString() })

  if (error) return { error: `Error al guardar: ${error.message}` }

  // Revalidar todas las páginas que muestran el sidebar
  revalidatePath('/', 'layout')
  return {}
}
