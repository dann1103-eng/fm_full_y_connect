// Testing strategy: cubierto por el flujo end-to-end en Task 10 (no unit test).
// Mockear cookies() + Supabase introduce más fragilidad que valor.

import { cookies } from 'next/headers'
import { createClient } from './server'
import { createAdminClient } from './admin'
import { IMPERSONATE_COOKIE } from '@/lib/auth/effective-user'

export const ACTIVE_CLIENT_COOKIE = 'portal_active_client'

interface ClientUserRow {
  client_id: string
  clients: { name: string } | null
}

/**
 * Ordena las marcas por nombre (locale es) para que "la primera marca" sea
 * estable y predecible: es la que se abre por defecto al entrar al portal.
 */
function sortByClientName(rows: ClientUserRow[]): string[] {
  return [...rows]
    .sort((a, b) => (a.clients?.name ?? '').localeCompare(b.clients?.name ?? '', 'es'))
    .map((r) => r.client_id)
}

/** Devuelve todos los client_id vinculados al user efectivo (real o suplantado). */
export async function getActiveClientIds(): Promise<string[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  // Si admin está suplantando a un cliente, leer los client_id del impersonado
  // (vía admin client para bypass RLS).
  const cookieStore = await cookies()
  const impersonateId = cookieStore.get(IMPERSONATE_COOKIE)?.value
  if (impersonateId && impersonateId !== user.id) {
    const { data: realUser } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()
    if (realUser?.role === 'admin') {
      const admin = createAdminClient()
      const { data } = await admin
        .from('client_users')
        .select('client_id, clients:client_id ( name )')
        .eq('user_id', impersonateId)
      return sortByClientName((data ?? []) as unknown as ClientUserRow[])
    }
  }

  const { data, error } = await supabase
    .from('client_users')
    .select('client_id, clients:client_id ( name )')
    .eq('user_id', user.id)

  if (error || !data) return []
  return sortByClientName(data as unknown as ClientUserRow[])
}

/**
 * Resuelve el client_id activo leyendo la cookie. Si no hay cookie válida,
 * cae a la PRIMERA marca (orden alfabético por nombre).
 *
 * Solo devuelve null cuando el usuario no tiene ninguna marca vinculada —
 * caso anómalo que el layout del portal resuelve cerrando sesión.
 *
 * Antes devolvía null con varias marcas y sin cookie, lo que enviaba al usuario
 * a /portal/seleccionar-marca. Esa pantalla se eliminó (sus botones no
 * disparaban el server action, así que el usuario quedaba atrapado): ahora se
 * entra directo a una marca y se cambia con el desplegable del sidebar
 * (ActiveClientSwitcher), que ya persiste la cookie.
 */
export async function getActiveClientId(): Promise<string | null> {
  const ids = await getActiveClientIds()
  if (ids.length === 0) return null

  const cookieStore = await cookies()
  const fromCookie = cookieStore.get(ACTIVE_CLIENT_COOKIE)?.value

  if (fromCookie && ids.includes(fromCookie)) return fromCookie
  return ids[0]
}
