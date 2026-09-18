import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientBrandProfile, Database } from '@/types/db'

type Db = SupabaseClient<Database>

/**
 * Perfil de marca del cliente (bloque 3). Como el resto de loaders de matrices, **lanza** ante un
 * error de consulta: la página muestra el error boundary en vez de un perfil vacío que parezca
 * "este cliente no tiene perfil" y deshabilite la generación sin motivo. Sin fila devuelve `null`,
 * que sí es el caso normal de un cliente al que nadie le llenó el perfil todavía.
 *
 * Acepta cualquier `SupabaseClient<Database>`: el autenticado en el perfil del cliente y el admin
 * client en el handler de IA.
 */
export async function loadBrandProfile(db: Db, clientId: string): Promise<ClientBrandProfile | null> {
  const { data, error } = await db
    .from('client_brand_profiles')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw new Error(`loadBrandProfile: ${error.message}`)
  const profile = (data as ClientBrandProfile | null) ?? null
  if (!profile) return null
  // `sample_copies` es `jsonb` y el check de la 0131 solo garantiza `jsonb_typeof = 'array'`: nada
  // obliga a que los elementos sean strings. Un número o un objeto (un fix por SQL a mano) reventaría
  // en la tarjeta al hacer `.trim()` y, peor, llegaría al handler de IA —que lee esta misma fila con
  // el admin client— como un job fallido en vez de un error de render. Se coacciona en el borde.
  // `base_hashtags` no lo necesita: es `text[]`, Postgres ya garantiza el tipo de cada elemento.
  return {
    ...profile,
    sample_copies: Array.isArray(profile.sample_copies)
      ? profile.sample_copies.filter((c): c is string => typeof c === 'string')
      : null,
  }
}
