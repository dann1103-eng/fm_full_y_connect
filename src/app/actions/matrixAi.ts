'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertNotImpersonating } from './impersonation'
import { canManageMatrices } from '@/lib/domain/permissions'
import { hasUsableBrandProfile } from '@/lib/domain/brand'
import { MATRIX_INSTRUCTIONS_MAX, generationGate, missingByType, type ChildWorkJob } from '@/lib/domain/matrix-ai'
import { loadBrandProfile } from '@/lib/data/brand'
import { loadMatrixEditorData } from '@/lib/data/matrices'
import { MATRIX_JOB_PRIORITY } from '@/lib/ai/handlers/matrixGenerate'
import { triggerJobRunner } from '@/lib/ai/trigger'
import type { ActionResult } from '@/lib/domain/matrix'

type Ctx = { supabase: Awaited<ReturnType<typeof createClient>>; userId: string }

const INVALID_DATA = 'Datos inválidos.'
const LOAD_ERROR = 'No se pudieron cargar los datos. Intenta de nuevo.'
const GENERATION_RUNNING = 'Ya hay una generación en curso para esta matriz.'
const NO_BRAND_PROFILE = 'Este cliente no tiene perfil de marca.'

/** Autenticación + rol admin/supervisor, igual que en `matrices.ts`. */
async function requireManager(): Promise<Ctx | { error: string }> {
  await assertNotImpersonating()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }
  const { data } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (!canManageMatrices(data?.role)) return { error: 'Sin permisos' }
  return { supabase, userId: user.id }
}

/**
 * Encola el job padre `matrix_generate`.
 *
 * Todas las condiciones que la UI usa para deshabilitar el botón se **re-evalúan aquí**: la pantalla
 * pudo quedarse vieja, y entre que se pintó y el clic pudieron cambiar el cupo, el perfil de marca o
 * el estado de la matriz.
 *
 * El insert va con el **admin client**: `ai_jobs` no tiene ninguna policy de insert (su RLS es solo
 * de lectura para `is_admin()`), así que con el cliente autenticado un supervisor no encolaría nada.
 */
export async function generateMatrix(matrixId: string): Promise<ActionResult> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (typeof matrixId !== 'string' || !matrixId.trim()) return { ok: false, error: INVALID_DATA }

  let data: Awaited<ReturnType<typeof loadMatrixEditorData>>
  try {
    // Los loaders lanzan ante un error de consulta; dentro de una acción se devuelve `{ ok: false }`.
    data = await loadMatrixEditorData(ctx.supabase, matrixId)
  } catch (e) {
    console.error('[matrixAi] generateMatrix', e)
    return { ok: false, error: LOAD_ERROR }
  }
  if (!data) return { ok: false, error: 'Matriz no encontrada.' }
  // Generar en una matriz aprobada crearía piezas que el barrido del bloque 2 convertiría en
  // requerimientos reales sin que nadie las hubiera revisado.
  if (data.matrix.status !== 'draft') return { ok: false, error: 'Solo se puede generar en una matriz en borrador.' }

  let profile
  try {
    profile = await loadBrandProfile(ctx.supabase, data.matrix.client_id)
  } catch (e) {
    console.error('[matrixAi] loadBrandProfile', e)
    return { ok: false, error: LOAD_ERROR }
  }
  if (!hasUsableBrandProfile(profile)) return { ok: false, error: NO_BRAND_PROFILE }

  const capacity = missingByType(data.limits, data.usage)
  const admin = createAdminClient()

  // Con el cupo cubierto todavía puede haber trabajo: piezas sin redactar sin hijo (una matriz llenada a
  // mano, o un padre que murió antes de encolar). Los hijos solo hacen falta en ese caso — con cupo
  // faltante la compuerta ya abre — y se leen con el admin client: la única policy de `select` de
  // `ai_jobs` es `is_admin()` y un supervisor no la pasa (igual que la ruta de progreso).
  let childJobs: ChildWorkJob[] = []
  if (capacity.total === 0) {
    const { data: jobs, error: jobsError } = await admin
      .from('ai_jobs')
      .select('content_matrix_item_id, status')
      .eq('job_type', 'matrix_item_write')
      .eq('content_matrix_id', matrixId)
    if (jobsError) {
      console.error('[matrixAi] leer jobs hijos', jobsError.message)
      return { ok: false, error: LOAD_ERROR }
    }
    childJobs = jobs ?? []
  }
  const gate = generationGate(capacity.total, data.items, childJobs)
  if (!gate.ok) return { ok: false, error: gate.error }

  const { error } = await admin.from('ai_jobs').insert({
    job_type: 'matrix_generate',
    status: 'pending',
    priority: MATRIX_JOB_PRIORITY,
    client_id: data.matrix.client_id,
    triggered_by: ctx.userId,
    content_matrix_id: matrixId,
    // El handler lee el id de acá: `AiJobRow` (escrito a mano) no tiene las columnas nuevas.
    input_json: { matrixId },
    scheduled_for: new Date().toISOString(),
  })
  if (error) {
    // 23505 = el índice único parcial de 0131: ya hay un padre `pending`/`processing` para esta matriz.
    if (error.code === '23505') return { ok: false, error: GENERATION_RUNNING }
    console.error('[matrixAi] encolar matrix_generate', error.message)
    return { ok: false, error: 'No se pudo iniciar la generación. Intenta de nuevo.' }
  }

  void triggerJobRunner({ max: 2, waitMs: 0 })
  return { ok: true }
}

/**
 * Encola un hijo `matrix_item_write` para una sola pieza: el botón "Regenerar".
 *
 * Las `instructions` viajan en `input_json` a propósito (sobreviven a un re-arranque del watchdog) y
 * su tope se impone **en el servidor**: la caja del panel lateral ya lo limita, así que pasarse solo
 * es posible con una petición fabricada.
 */
export async function regenerateItem(itemId: string, instructions?: string | null): Promise<ActionResult<{ queued: boolean }>> {
  const ctx = await requireManager()
  if ('error' in ctx) return { ok: false, error: ctx.error }
  if (typeof itemId !== 'string' || !itemId.trim()) return { ok: false, error: INVALID_DATA }

  if (instructions !== undefined && instructions !== null && typeof instructions !== 'string') {
    return { ok: false, error: INVALID_DATA }
  }
  const trimmed = (instructions ?? '').trim()
  // `.length` (UTF-16) como el resto de los topes del bloque 1: así el contador de la caja y esta
  // validación cuentan lo mismo y no hay un rechazo que el usuario no pueda explicarse.
  if (trimmed.length > MATRIX_INSTRUCTIONS_MAX) {
    return { ok: false, error: `Las instrucciones no pueden pasar de ${MATRIX_INSTRUCTIONS_MAX} caracteres.` }
  }

  const { data: item, error: itemError } = await ctx.supabase
    .from('content_matrix_items')
    .select('id, matrix_id')
    .eq('id', itemId)
    .maybeSingle()
  if (itemError) {
    console.error('[matrixAi] leer pieza', itemError.message)
    return { ok: false, error: LOAD_ERROR }
  }
  if (!item) return { ok: false, error: 'Pieza no encontrada.' }

  const { data: matrix, error: matrixError } = await ctx.supabase
    .from('content_matrices')
    .select('id, status, client_id')
    .eq('id', item.matrix_id)
    .maybeSingle()
  if (matrixError) {
    console.error('[matrixAi] leer matriz', matrixError.message)
    return { ok: false, error: LOAD_ERROR }
  }
  if (!matrix) return { ok: false, error: 'Matriz no encontrada.' }
  // Funciona en `draft` y en `approved` (los textos siguen editables tras aprobar y el requerimiento
  // los lee en vivo), nunca en `closed`.
  if (matrix.status === 'closed') return { ok: false, error: 'La matriz está cerrada.' }

  // Sin perfil de marca el hijo terminaría `skipped` y en la pantalla no pasaría nada: mejor decirlo.
  let profile
  try {
    profile = await loadBrandProfile(ctx.supabase, matrix.client_id)
  } catch (e) {
    console.error('[matrixAi] loadBrandProfile', e)
    return { ok: false, error: LOAD_ERROR }
  }
  if (!hasUsableBrandProfile(profile)) return { ok: false, error: NO_BRAND_PROFILE }

  const admin = createAdminClient()
  const { error } = await admin.from('ai_jobs').insert({
    job_type: 'matrix_item_write',
    status: 'pending',
    priority: MATRIX_JOB_PRIORITY,
    client_id: matrix.client_id,
    triggered_by: ctx.userId,
    content_matrix_id: matrix.id,
    content_matrix_item_id: itemId,
    input_json: { itemId, instructions: trimmed || null },
    scheduled_for: new Date().toISOString(),
  })
  if (error) {
    // 23505 no es un error: esa pieza ya está en cola. Es lo que ataja el doble clic en "Regenerar".
    if (error.code === '23505') return { ok: true, queued: false }
    console.error('[matrixAi] encolar matrix_item_write', error.message)
    return { ok: false, error: 'No se pudo encolar la redacción. Intenta de nuevo.' }
  }

  void triggerJobRunner({ max: 2, waitMs: 0 })
  return { ok: true, queued: true }
}
