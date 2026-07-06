import type { createClient } from '@/lib/supabase/server'

/**
 * Helpers puros compartidos para arrancar timers de `time_entries`.
 * Extraídos de `src/app/actions/time.ts` para reusarlos también en las tareas
 * asignadas (`src/app/actions/tasks.ts`) sin duplicar la lógica de solapamiento.
 * No lleva `'use server'`: son funciones normales que reciben el cliente supabase
 * ya construido por el server action que las invoca.
 */

type SupaServer = Awaited<ReturnType<typeof createClient>>

/** Devuelve la entrada activa (ended_at IS NULL) del usuario, o null. */
export async function getActiveEntry(supabase: SupaServer, userId: string) {
  const { data } = await supabase
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .is('ended_at', null)
    .maybeSingle()
  return data
}

/**
 * Busca una time_entry del usuario que se solape con [startedAt, endedAt).
 * Devuelve la primera coincidencia, o null si no hay solapamiento.
 *
 * Definición de overlap (intervalos semi-abiertos):
 *   existing.started_at < new.ended_at
 *   AND (existing.ended_at > new.started_at OR existing.ended_at IS NULL)
 *
 * Si endedAt es null (live timer arrancando), se trata el nuevo intervalo como
 * [startedAt, +infinity) y se busca cualquier existente que termine después de
 * startedAt o esté abierto.
 */
export async function findOverlappingEntry(
  supabase: SupaServer,
  userId: string,
  startedAt: Date,
  endedAt: Date | null,
  excludeEntryId: string | null = null,
) {
  let q = supabase
    .from('time_entries')
    .select('id, title, started_at, ended_at')
    .eq('user_id', userId)

  if (endedAt) {
    q = q.lt('started_at', endedAt.toISOString())
  }
  q = q.or(`ended_at.gt.${startedAt.toISOString()},ended_at.is.null`)
  if (excludeEntryId) q = q.neq('id', excludeEntryId)

  const { data } = await q.limit(1)
  return (data && data.length > 0) ? data[0] : null
}

function formatHm(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function overlapErrorMsg(other: { title: string | null; started_at: string; ended_at: string | null }): string {
  const range = other.ended_at
    ? `${formatHm(other.started_at)} – ${formatHm(other.ended_at)}`
    : `desde ${formatHm(other.started_at)} (activa)`
  const title = other.title?.trim() || 'otra entrada'
  return `Se solapa con "${title}" (${range}). Ajustá los horarios o eliminá la entrada existente.`
}
