/**
 * Configuración del modelo para la generación de matrices (bloque 3), en un solo lugar.
 *
 * No hay tabla de configuración para esto (a diferencia de `wa_bot_configs`): son dos prompts y no vale
 * la pena inventarle una. Si algún día hace falta editarlos sin redeploy, ese es el momento.
 */

/**
 * Modelo de la generación. **Variable propia a propósito**: `ANTHROPIC_MODEL` es la del bot de WhatsApp
 * y cambiarla para el bot no debe alterar en silencio la generación de matrices.
 *
 * Se lee en cada llamada (no al importar el módulo) para que cambiar la variable en Vercel surta efecto
 * sin rebuild.
 */
export function matrixModel(): string {
  return process.env.ANTHROPIC_MATRIX_MODEL || 'claude-sonnet-4-6'
}

/** Padre (`matrix_generate`): plan completo de la matriz, poca creatividad y mucho espacio de salida. */
export const MATRIX_PARENT_PARAMS = { max_tokens: 4000, temperature: 0.7 } as const

/**
 * Hijo (`matrix_item_write`): un solo brief, más suelto de creatividad y mucho más corto.
 *
 * `max_tokens` va atado a `BRIEF_WORKING_RANGES` de `prompts.ts`: el peor caso de esos rangos tiene que
 * caber con holgura, y lo fija `prompts.test.ts`. Subirlo no cuesta por sí solo (se cobra lo generado),
 * pero alarga el peor caso de un job dentro del presupuesto de 45 s del runner.
 */
export const MATRIX_CHILD_PARAMS = { max_tokens: 1500, temperature: 0.8 } as const

/**
 * Lee la API key y **lanza** si falta: el job termina `failed` tras los reintentos y queda visible en el
 * editor de la matriz — la franja roja del padre ("La última generación con IA falló…" con el
 * `error_text`) o, en un hijo, "No se pudo redactar" en la fila, con el detalle en el panel de la pieza.
 * **No** sale en `WaBotFailedJobs` de `/admin/whatsapp`: ese panel solo lista los jobs del bot y los
 * recordatorios de factura.
 */
export function requireAnthropicApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('Generación de matriz: falta ANTHROPIC_API_KEY')
  return apiKey
}
