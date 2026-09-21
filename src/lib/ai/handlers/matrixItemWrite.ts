import Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadBrandProfile } from '@/lib/data/brand'
import { hasUsableBrandProfile } from '@/lib/domain/brand'
import { periodLabel } from '@/lib/domain/matrix'
import { briefOutcome, sanitizeGeneratedBrief } from '@/lib/domain/matrix-ai'
import { MATRIX_CHILD_PARAMS, matrixModel, requireAnthropicApiKey } from '@/lib/ai/matrix/model'
import { accumulateJobCost } from '@/lib/ai/matrix/cost'
import {
  MATRIX_BRIEF_TOOL_NAME, buildBrandSystemBlock, buildBriefPrompt, forceTool, matrixBriefTool, readToolInput,
} from '@/lib/ai/matrix/prompts'
import type { AiHandler } from '@/lib/ai/types'
import type { Client, ContentMatrix, ContentMatrixItem } from '@/types/db'

interface ItemWriteInput {
  itemId?: string
  /** Instrucciones del usuario al regenerar. Viajan en `input_json` para sobrevivir a un re-arranque. */
  instructions?: string | null
}

// `type` y no `interface`: solo un alias de tipo objeto es asignable a `Record<string, unknown>`
// (el `result_json` del job), una interfaz no lo es.
type ItemWriteResult = {
  written: boolean
  /** Campos del brief efectivamente escritos, para auditar una respuesta a medias. */
  fields?: string[]
  skipped?: string
}

/**
 * Handler hijo `matrix_item_write` (bloque 3): redacta el brief de UNA pieza y marca `ai_written_at`.
 * Es también el job del botón "Regenerar".
 *
 * Diseño: `docs/superpowers/specs/2026-09-17-creador-de-matrices-bloque-3-design.md` (Partes 3 y 4).
 *
 * Escribe **solo** lo que devuelve `sanitizeGeneratedBrief`, que descarta cualquier clave ajena al
 * brief: así una pieza ya `converted` no puede perder ninguno de los cinco campos que el bloque 2
 * congela (`title`, `content_type`, `deadline`, `assigned_to`, `estimated_time_minutes`) aunque el
 * modelo se los invente.
 */
export const matrixItemWriteHandler: AiHandler<ItemWriteInput, ItemWriteResult> = async (ctx) => {
  // Los ids se leen de `input_json`: `AiJobRow` de `src/lib/ai/types.ts` está escrito a mano y no
  // tiene `content_matrix_item_id` (mismo patrón que `invoiceDueReminder` con `invoiceId`).
  const { itemId, instructions } = ctx.job.input_json as ItemWriteInput
  if (!itemId) throw new Error('matrix_item_write: itemId requerido')

  // Admin client propio y TIPADO: `ctx.supabase` es un `SupabaseClient` genérico y no se escribe con él.
  const admin = createAdminClient()

  // ── Paso 1: la pieza y su matriz ─────────────────────────────────────────
  const { data: itemRaw, error: itemError } = await admin
    .from('content_matrix_items')
    .select('*')
    .eq('id', itemId)
    .maybeSingle()
  if (itemError) throw new Error(`matrix_item_write: no se pudo leer la pieza: ${itemError.message}`)
  // Pieza borrada mientras el job esperaba: `skipped`, NUNCA un throw. Un throw quemaría los tres
  // intentos y ensuciaría la lista de jobs fallidos por algo que ya no tiene arreglo.
  if (!itemRaw) {
    await ctx.logEvent('skipped', { reason: 'pieza_no_existe', itemId })
    return { written: false, skipped: 'pieza_no_existe' }
  }
  const item = itemRaw as ContentMatrixItem

  const { data: matrixRaw, error: matrixError } = await admin
    .from('content_matrices')
    .select('*')
    .eq('id', item.matrix_id)
    .maybeSingle()
  if (matrixError) throw new Error(`matrix_item_write: no se pudo leer la matriz: ${matrixError.message}`)
  if (!matrixRaw) {
    await ctx.logEvent('skipped', { reason: 'matriz_no_existe', itemId })
    return { written: false, skipped: 'matriz_no_existe' }
  }
  const matrix = matrixRaw as ContentMatrix
  // Una matriz cerrada es un estado terminal y rechaza las escrituras sobre sus piezas. Una pieza
  // `blocked`, en cambio, SÍ se redacta: el brief no es ninguno de los campos congelados.
  if (matrix.status === 'closed') {
    await ctx.logEvent('skipped', { reason: 'matriz_cerrada', itemId })
    return { written: false, skipped: 'matriz_cerrada' }
  }

  const [{ data: clientRaw, error: clientError }, profile] = await Promise.all([
    admin.from('clients').select('name, giro').eq('id', matrix.client_id).maybeSingle(),
    loadBrandProfile(admin, matrix.client_id),
  ])
  if (clientError) throw new Error(`matrix_item_write: no se pudo leer el cliente: ${clientError.message}`)
  if (!clientRaw) {
    await ctx.logEvent('skipped', { reason: 'cliente_no_existe', itemId })
    return { written: false, skipped: 'cliente_no_existe' }
  }
  // La compuerta del bloque, re-evaluada también aquí: el perfil pudo vaciarse entre el encolado y ahora.
  if (!profile || !hasUsableBrandProfile(profile)) {
    await ctx.logEvent('skipped', { reason: 'sin_perfil_de_marca', itemId })
    return { written: false, skipped: 'sin_perfil_de_marca' }
  }

  // ── Paso 2: la llamada al modelo ─────────────────────────────────────────
  await ctx.logEvent('progress', { step: 'claude_call', itemId })
  const anthropic = new Anthropic({ apiKey: requireAnthropicApiKey() })
  const response = await anthropic.messages.create({
    model: matrixModel(),
    max_tokens: MATRIX_CHILD_PARAMS.max_tokens,
    temperature: MATRIX_CHILD_PARAMS.temperature,
    system: [{
      type: 'text',
      text: buildBrandSystemBlock({
        client: clientRaw as Pick<Client, 'name' | 'giro'>,
        profile,
        matrix,
        period: {
          periodStart: matrix.period_start,
          periodEnd: matrix.period_end,
          label: periodLabel(matrix.period_start, matrix.period_end),
        },
      }),
      // El bloque de marca es idéntico para todas las piezas de la misma matriz. **Sin prometer
      // ahorro**: la caché efímera vive unos minutos y tiene un mínimo de bloque que un perfil corto
      // puede no alcanzar; si pega, bien.
      cache_control: { type: 'ephemeral' },
    }],
    tools: [matrixBriefTool()],
    tool_choice: forceTool(MATRIX_BRIEF_TOOL_NAME),
    messages: [{ role: 'user', content: buildBriefPrompt({ item, instructions }) }],
  })
  // Acumulado, no sobrescrito: un job rescatado por el watchdog de 0124 paga dos llamadas al modelo.
  await accumulateJobCost(admin, ctx.job.id, response.usage)

  // ── Paso 3: el único filtro entre el modelo y la base ────────────────────
  const patch = sanitizeGeneratedBrief(readToolInput(response.content, MATRIX_BRIEF_TOOL_NAME))
  const fields = Object.keys(patch)
  const outcome = briefOutcome(response.stop_reason, fields.length)
  if (outcome === 'truncada') {
    // Ni escribir el brief a medias (marcaría `ai_written_at` y el padre no lo re-encolaría nunca) ni
    // lanzar (el runner repetiría el mismo prompt, con el mismo corte, dos veces más a precio completo).
    // El job termina una sola vez y la pieza queda recuperable con "Regenerar".
    await ctx.logEvent('skipped', {
      reason: 'respuesta_truncada',
      itemId,
      output_tokens: response.usage.output_tokens,
      fields,
    })
    return { written: false, skipped: 'respuesta_truncada' }
  }
  if (outcome === 'vacia') {
    // Sin truncar y sin ningún campo usable (tool_use ausente o con basura): aquí sí vale la pena reintentar.
    throw new Error(`matrix_item_write: el modelo no devolvió un brief usable (stop_reason=${response.stop_reason})`)
  }

  // ── Paso 4: escribir el brief ────────────────────────────────────────────
  const { error: updateError } = await admin
    .from('content_matrix_items')
    .update({ ...patch, ai_written_at: new Date().toISOString() })
    .eq('id', itemId)
  if (updateError) throw new Error(`matrix_item_write: no se pudo guardar el brief: ${updateError.message}`)

  return { written: true, fields }
}
