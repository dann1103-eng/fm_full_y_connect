'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import type { Database } from '@/types/db'

type ClientUpdate = Database['public']['Tables']['clients']['Update']

export async function updateClientProfile(
  clientId: string,
  data: Record<string, string | null>
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')

  // Verificar que el user es dueño de este cliente
  const { data: link } = await supabase
    .from('client_users')
    .select('client_id')
    .eq('user_id', user.id)
    .eq('client_id', clientId)
    .maybeSingle()

  if (!link) throw new Error('Sin acceso a este cliente')

  // Solo campos permitidos — whitelist explícita
  const ALLOWED = [
    'name', 'contact_email', 'contact_phone',
    'ig_handle', 'fb_handle', 'tiktok_handle', 'yt_handle', 'linkedin_handle',
    'website_url', 'other_contact',
    'legal_name', 'nit', 'nrc', 'dui', 'fiscal_address', 'giro',
  ] as const

  const safe: ClientUpdate = {}
  for (const key of ALLOWED) {
    if (key in data) (safe as Record<string, string | null>)[key] = data[key] ?? null
  }

  if (Object.keys(safe).length === 0) return

  const admin = createAdminClient()
  const { error } = await admin.from('clients').update(safe).eq('id', clientId)
  if (error) throw new Error(error.message)

  revalidatePath('/portal/empresa')
}
