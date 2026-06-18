'use server'

import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'

/**
 * Reclama una nueva sesión para el usuario actual.
 * Genera un UUID, lo guarda en `users.current_session_id` y lo retorna.
 * El cliente lo persiste en `localStorage['fm_session_id']`. Cualquier otro
 * dispositivo del mismo usuario detectará el cambio vía realtime y se
 * auto-deslogueará (ver SessionSentinel).
 */
export async function claimSession(): Promise<
  { ok: true; sessionId: string } | { error: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const sessionId = randomUUID()
  const { error } = await supabase
    .from('users')
    .update({ current_session_id: sessionId })
    .eq('id', user.id)

  if (error) return { error: error.message }
  return { ok: true, sessionId }
}

/**
 * Verifica el estado del `localSessionId` del cliente contra el
 * `current_session_id` actual en la BD. Usado como fallback cuando realtime
 * está caído (polling cada 30s + on visibilitychange).
 *
 * Devuelve tres estados — IMPORTANTE distinguirlos para no expulsar por error:
 * - `valid`:      el id local coincide con la BD. Todo bien.
 * - `superseded`: la BD tiene OTRO id no-nulo → otro dispositivo reclamó la
 *                 sesión. Este es el ÚNICO caso que debe expulsar.
 * - `unknown`:    no se pudo confirmar (auth transitorio sin user, fila/columna
 *                 nula tras un signout, error de red/RLS). NO expulsar: tratar
 *                 "no pude confirmar" como expulsión causaba falsos positivos
 *                 que sacaban al usuario en su única sesión legítima.
 */
export async function verifySession(
  localSessionId: string,
): Promise<{ status: 'valid' | 'superseded' | 'unknown' }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: 'unknown' }

  const { data, error } = await supabase
    .from('users')
    .select('current_session_id')
    .eq('id', user.id)
    .maybeSingle()

  if (error || !data) return { status: 'unknown' }

  const dbId = data.current_session_id
  if (!dbId) return { status: 'unknown' }

  return { status: dbId === localSessionId ? 'valid' : 'superseded' }
}
