import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/db'

/**
 * Costo y tokens de las llamadas al modelo en la generación de matrices (bloque 3).
 *
 * Vive aparte de los dos handlers a propósito: la fórmula ya costó una migración de corrección
 * (0123, el `*100` de más) y duplicarla en el padre y en el hijo sería la forma de que una de las
 * dos copias se corrija y la otra no.
 *
 * Precios de Claude Sonnet 4.6 en USD por MILLÓN de tokens, los mismos de `whatsappReply.ts`. Si se
 * cambia el modelo (`ANTHROPIC_MATRIX_MODEL`) hay que actualizar estas tres tarifas.
 */
const USD_PER_MTOK_INPUT = 3
const USD_PER_MTOK_CACHE_READ = 0.3
const USD_PER_MTOK_OUTPUT = 15

/** Lo que devuelve `response.usage` del SDK, reducido a lo que se cobra. */
export interface ModelUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
}

/**
 * Céntimos de USD enteros. `/1_000_000` porque las tarifas son por millón de tokens y `*100` una sola
 * vez para pasar de dólares a céntimos: **no hay un segundo `*100`** (ese fue el bug de la 0123).
 *
 * Limitación conocida y heredada: no se lee `cache_creation_input_tokens`, así que la escritura de
 * caché se cobra a precio de entrada normal y el total queda ~1.25× por debajo.
 */
export function costCentsFor(usage: ModelUsage): number {
  const cached = usage.cache_read_input_tokens ?? 0
  const fresh = Math.max(0, usage.input_tokens - cached)
  const usd =
    (fresh * USD_PER_MTOK_INPUT + cached * USD_PER_MTOK_CACHE_READ + usage.output_tokens * USD_PER_MTOK_OUTPUT) /
    1_000_000
  return Math.ceil(usd * 100)
}

/**
 * **Suma** el costo y los tokens sobre lo que ya tenga la fila, en vez de sobrescribirlos: un job
 * rescatado por el watchdog de 0124 paga dos llamadas al modelo y sobrescribiendo registraría una
 * sola, subestimando justo los fallos que interesa ver.
 *
 * No es atómico (lectura + escritura, sin RPC): el único escritor de esas columnas es el handler que
 * está corriendo el job, así que la carrera solo existiría entre un job colgado y su rescate, que es
 * precisamente lo que el watchdog no hace antes de los 5 minutos.
 */
export async function accumulateJobCost(
  admin: SupabaseClient<Database>,
  jobId: string,
  usage: ModelUsage,
): Promise<number> {
  const cached = usage.cache_read_input_tokens ?? 0
  const cents = costCentsFor(usage)

  const { data, error: readError } = await admin
    .from('ai_jobs')
    .select('cost_usd_cents, tokens_input, tokens_output, tokens_cached')
    .eq('id', jobId)
    .maybeSingle()
  // Se escribe igual: en la primera llamada del job (el caso normal) el acumulado previo es cero y el
  // valor es correcto; solo un job rescatado perdería la llamada anterior, y queda en el log.
  if (readError) console.error('[matrix cost] no se pudo leer el acumulado del job', jobId, readError.message)

  // **No fatal**: la llamada al modelo ya se hizo y el brief o el plan valen más que la contabilidad.
  // Pero tampoco mudo — es la única traza del gasto de ese job.
  const { data: updated, error } = await admin
    .from('ai_jobs')
    .update({
      cost_usd_cents: (data?.cost_usd_cents ?? 0) + cents,
      tokens_input: (data?.tokens_input ?? 0) + usage.input_tokens,
      tokens_output: (data?.tokens_output ?? 0) + usage.output_tokens,
      tokens_cached: (data?.tokens_cached ?? 0) + cached,
    })
    .eq('id', jobId)
    .select('id')
  if (error) {
    console.error('[matrix cost] no se pudo registrar el costo del job', jobId, `${cents}¢`, error.message)
  } else if (!updated || updated.length === 0) {
    // Un update sobre una fila inexistente no da error: la fila del job cayó por el `on delete cascade`
    // de 0131 (se borró la pieza o la matriz mientras corría) y el gasto se pierde con ella.
    console.error('[matrix cost] el job ya no existe (¿pieza o matriz borrada?): costo perdido', jobId, `${cents}¢`)
  }

  return cents
}
