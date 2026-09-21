import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Barrido de **zombis agotados** de la cola `ai_jobs`. Lo llama `runJobs` antes de reclamar.
 *
 * Un zombi agotado es un job que quedó `processing` en su ÚLTIMO intento: la plataforma mató la función
 * entre `claim_ai_job` (que ya subió `attempts` hasta `max_attempts`) y `completeJob`/`failJob`. El
 * watchdog de 0124 solo rescata `processing` con `attempts < max_attempts`, así que a ese job ya no lo
 * mira nadie y queda `processing` para siempre. Con los índices únicos parciales que cubren `processing`
 * (0126 para el recordatorio de factura, 0131 para las matrices) eso además es un **candado permanente**:
 * un `matrix_generate` zombi deja "Planificando…" y "Ya hay una generación en curso" para siempre, un
 * `matrix_item_write` zombi deja "Redactando…" y "Regenerar" choca en silencio con el 23505, y solo un
 * update a mano lo destraba. Marcado `failed`, un `whatsapp_reply` o un recordatorio colgado aparece en
 * `WaBotFailedJobs` en vez de desaparecer, y una matriz vuelve a poder generarse.
 *
 * Aplica a TODOS los tipos de job. Corre en el runner del bot de WhatsApp y de los recordatorios, así que
 * **nunca lanza** (cualquier error se loguea y el runner sigue) y cuesta una sola lectura acotada por
 * invocación; el update y el evento solo ocurren cuando de verdad hay zombis.
 */

/**
 * Edad mínima del `locked_at`: el doble del umbral del watchdog de 0124 (5 min) y muy por encima del
 * `maxDuration = 180` de `/api/ai-jobs/process`, así que ninguna función puede seguir viva con ese job.
 */
export const EXHAUSTED_ZOMBIE_AGE_MS = 10 * 60_000

/** Tope de la lectura: los zombis son raros y lo que no entre se barre en la invocación siguiente. */
export const EXHAUSTED_ZOMBIE_SCAN_LIMIT = 50

export const EXHAUSTED_ZOMBIE_ERROR = 'La función terminó sin respuesta en el último intento.'

export interface ZombieCandidate {
  id: string
  attempts: number
  max_attempts: number
}

/**
 * De los `processing` viejos, los que ya no tienen reintento. Se filtra en JS porque PostgREST no
 * compara dos columnas en un filtro; los que aún tienen intentos los rescata el watchdog de 0124.
 */
export function exhaustedZombieIds(rows: readonly ZombieCandidate[]): string[] {
  return rows.filter((r) => r.attempts >= r.max_attempts).map((r) => r.id)
}

/** Marca `failed` los zombis agotados. Devuelve los ids que efectivamente cambió (vacío ante cualquier error). */
export async function sweepExhaustedZombies(supabase: SupabaseClient, now: Date = new Date()): Promise<string[]> {
  try {
    const cutoff = new Date(now.getTime() - EXHAUSTED_ZOMBIE_AGE_MS).toISOString()
    const { data, error } = await supabase
      .from('ai_jobs')
      .select('id, attempts, max_attempts')
      .eq('status', 'processing')
      .lt('locked_at', cutoff)
      .order('locked_at', { ascending: true })
      .limit(EXHAUSTED_ZOMBIE_SCAN_LIMIT)
    if (error) {
      console.error('[ai/runner] barrido de zombis: no se pudo leer', error.message)
      return []
    }

    const ids = exhaustedZombieIds((data ?? []) as ZombieCandidate[])
    if (ids.length === 0) return []

    const { data: updated, error: updateError } = await supabase
      .from('ai_jobs')
      .update({
        status: 'failed',
        finished_at: now.toISOString(),
        locked_at: null,
        locked_by: null,
        error_text: EXHAUSTED_ZOMBIE_ERROR,
      })
      .in('id', ids)
      // Un job que terminó entre la lectura y este update NO se pisa: solo se toca lo que sigue colgado.
      .eq('status', 'processing')
      .lt('locked_at', cutoff)
      .select('id')
    if (updateError) {
      console.error('[ai/runner] barrido de zombis: no se pudo marcar failed', updateError.message)
      return []
    }

    const swept = ((updated ?? []) as Array<{ id: string }>).map((r) => r.id)
    if (swept.length > 0) {
      console.warn('[ai/runner] zombis agotados marcados failed', { ids: swept })
      // Mismo rastro que deja `failJob`. Sin comprobar el error, igual que `logEvent`: es auditoría.
      await supabase.from('ai_job_events').insert(
        swept.map((id) => ({ job_id: id, event_type: 'failed', payload: { error: EXHAUSTED_ZOMBIE_ERROR, swept: true } })),
      )
    }
    return swept
  } catch (e) {
    console.error('[ai/runner] barrido de zombis falló', e instanceof Error ? e.message : String(e))
    return []
  }
}
