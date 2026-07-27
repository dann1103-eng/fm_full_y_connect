import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Busca la conversación de un número y la crea si no existe. Devuelve su id.
 *
 * `wa_conversations.phone_e164` es UNIQUE, así que hay una sola conversación
 * por número aunque el número esté vinculado a varias marcas (migración 0122):
 * `client_id` es la marca ACTIVA, no una llave de partición.
 *
 * Requiere un cliente con acceso a las tablas `wa_*` (service role,
 * `createWaAdminClient`).
 */
export async function resolveWaConversation(
  waAdmin: SupabaseClient,
  phoneE164: string,
  clientId: string | null,
): Promise<string> {
  const existing = await waAdmin
    .from('wa_conversations')
    .select('id')
    .eq('phone_e164', phoneE164)
    .maybeSingle()
  if (existing.data) return (existing.data as { id: string }).id

  const created = await waAdmin
    .from('wa_conversations')
    .insert({ phone_e164: phoneE164, client_id: clientId })
    .select('id')
    .single()
  if (created.error || !created.data) {
    throw new Error(`no se pudo crear la conversación de WhatsApp: ${created.error?.message}`)
  }
  return (created.data as { id: string }).id
}
