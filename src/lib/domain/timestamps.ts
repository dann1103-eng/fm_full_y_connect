/**
 * Comparación de `timestamptz` de PostgREST — dominio puro.
 *
 * Vive aparte para que la usen a la vez el editor (`matrix-generation.ts`, que la re-exporta) y los
 * handlers (`matrix-ai.ts`) sin que un módulo importe al otro. **Nunca comparar estas marcas como
 * strings**: la misma instante puede llegar como `…Z` (un `toISOString()` de JS) o como `…+00:00` con
 * microsegundos (Postgres), y el orden lexicográfico de esas dos formas no es el temporal.
 */

/**
 * `timestamptz` de PostgREST → microsegundos desde epoch, o `null` si es ilegible. `Date.parse` se
 * queda en milisegundos y Postgres guarda microsegundos: dos escrituras dentro del mismo milisegundo
 * serían "iguales" y una respuesta vieja pasaría por nueva.
 */
export function timestampMicros(ts: string): number | null {
  const ms = Date.parse(ts)
  if (Number.isNaN(ms)) return null
  // La fracción va justo después de los segundos (`:SS.ffffff`); Postgres recorta los ceros finales.
  const frac = /:\d{2}\.(\d+)/.exec(ts)
  const micros = frac ? Number(`${frac[1]}000000`.slice(0, 6)) : 0
  return Math.floor(ms / 1000) * 1_000_000 + micros
}

/** Negativo si `a` es anterior a `b`, 0 si son iguales, positivo si es posterior. Ilegible = el más viejo. */
export function compareTimestamps(a: string, b: string): number {
  const x = timestampMicros(a)
  const y = timestampMicros(b)
  if (x === null || y === null) return x === y ? 0 : x === null ? -1 : 1
  return x - y
}
