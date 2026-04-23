// Testing strategy: cubierto por el flujo end-to-end en Task 10 (no unit test).
// Mockear cookies() + Supabase introduce más fragilidad que valor.

import { cookies } from 'next/headers'
import { createClient } from './server'

export const ACTIVE_CLIENT_COOKIE = 'portal_active_client'

/** Devuelve todos los client_id vinculados al user autenticado. */
export async function getActiveClientIds(): Promise<string[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('client_users')
    .select('client_id')
    .eq('user_id', user.id)

  if (error || !data) return []
  return data.map((r) => r.client_id)
}

/**
 * Resuelve el client_id activo leyendo la cookie; si la cookie no está o
 * apunta a un client_id fuera de la lista del user, devuelve null.
 * Los server components deben redirigir a /portal/seleccionar-marca cuando
 * esta función retorna null pero getActiveClientIds() tiene al menos uno.
 */
export async function getActiveClientId(): Promise<string | null> {
  const ids = await getActiveClientIds()
  if (ids.length === 0) return null

  const cookieStore = await cookies()
  const fromCookie = cookieStore.get(ACTIVE_CLIENT_COOKIE)?.value

  if (fromCookie && ids.includes(fromCookie)) return fromCookie
  if (ids.length === 1) return ids[0]

  return null
}
