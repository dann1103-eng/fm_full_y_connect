'use server'

import { createClient } from '@/lib/supabase/server'
import { assertNotImpersonating } from './impersonation'
import type { PresenceStatus } from '@/types/db'

const VALID: readonly PresenceStatus[] = ['online', 'away', 'almuerzo']

/**
 * Actualiza updated_at del usuario actual sin cambiar su status — mantiene
 * la sesión como "activa" para que el indicador no aparezca como offline.
 * Si no existe fila, la crea con status 'online'.
 */
export async function touchPresence() {
  try {
    await assertNotImpersonating()
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    // Intenta tocar updated_at sin cambiar status (el trigger lo actualiza a now())
    const { data } = await supabase
      .from('user_presence')
      .update({ updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .select('user_id')

    // Si no existía fila, la crea con online por defecto
    if (!data || data.length === 0) {
      await supabase
        .from('user_presence')
        .insert({ user_id: user.id, status: 'online' })
    }
  } catch {
    // No es crítico — fallo silencioso
  }
}

/**
 * Setea el estado manual del usuario actual. El estado "en llamada" no se
 * guarda — se deriva client-side cruzando call_participants activos.
 */
export async function setPresenceStatus(status: PresenceStatus) {
  try {
    await assertNotImpersonating()
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { error: 'No autenticado' }

    if (!VALID.includes(status)) {
      return { error: 'Estado inválido' }
    }

    // Upsert — primera vez que el user toca presence se inserta el row.
    const { error } = await supabase
      .from('user_presence')
      .upsert(
        { user_id: user.id, status },
        { onConflict: 'user_id' }
      )

    if (error) return { error: error.message }
    return { ok: true }
  } catch (e) {
    console.error('setPresenceStatus failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

/**
 * Actualiza el status descriptivo libre del usuario (emoji + texto corto,
 * "feliz", "ocupado", etc). Independiente del status formal online/away.
 * Limitado a 8 chars de emoji y 60 chars de texto.
 */
export async function setStatusMessage(payload: {
  emoji?: string | null
  message?: string | null
}) {
  try {
    await assertNotImpersonating()
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { error: 'No autenticado' }

    const update: { status_emoji?: string | null; status_message?: string | null } = {}
    if (payload.emoji !== undefined) {
      const trimmed = (payload.emoji ?? '').trim()
      update.status_emoji = trimmed === '' ? null : trimmed.slice(0, 8)
    }
    if (payload.message !== undefined) {
      const trimmed = (payload.message ?? '').trim()
      update.status_message = trimmed === '' ? null : trimmed.slice(0, 60)
    }

    if (Object.keys(update).length === 0) return { ok: true }

    // Upsert — la fila puede no existir si el usuario nunca tocó presence.
    const { error } = await supabase
      .from('user_presence')
      .upsert(
        { user_id: user.id, status: 'online', ...update },
        { onConflict: 'user_id' }
      )

    if (error) return { error: error.message }
    return { ok: true }
  } catch (e) {
    console.error('setStatusMessage failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}
