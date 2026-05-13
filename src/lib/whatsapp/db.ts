import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente Supabase **sin tipar** específicamente para las tablas wa_* y bot_configs
 * (no las añadimos al tipo `Database` para no inflar la profundidad de inferencia
 * que rompe la resolución de tipos en queries de otras tablas).
 *
 * Lecturas: el llamador casteará el resultado a WaConversation/WaMessage/etc.
 * Escrituras: se aceptan `Record<string, unknown>` sin restricción de columnas.
 */
export function createWaAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
