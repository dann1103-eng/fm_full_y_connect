import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { canManageMatrices } from '@/lib/domain/permissions'
import type { AiJobStatus, ContentMatrixItem, MatrixTopic } from '@/types/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Progreso de la generación con IA de una matriz (bloque 3).
 *
 * Route handler y no server action porque el sondeo necesita **cancelar la petición anterior** y una
 * server action no acepta `AbortSignal`.
 *
 * Auth: sesión normal. **No entra en `SECRET_AUTH_API_PREFIXES` de `src/proxy.ts`** (ese par de
 * secretos es para los crons; `startsWithAny` solo casa `/api/matrices/convert` exacto o con `/`, así
 * que esta ruta queda bajo el middleware como cualquier otra pantalla). Se re-valida el rol
 * admin/supervisor con el precedente de `/api/notifications`.
 *
 * Dos clientes a propósito: `ai_jobs` con el **admin client** (su única policy de `select` es
 * `is_admin()` y un supervisor no la pasa) y las tablas de matrices con el **cliente de sesión**,
 * cuya RLS ya es de admin/supervisor.
 */
type Phase = 'planning' | 'writing' | 'idle' | 'failed'

interface GenerationProgress {
  phase: Phase
  total: number
  done: number
  failed: number
  /** Piezas con un hijo vivo: incluye las de "Regenerar" sueltas, que no tienen padre. */
  writingItemIds: string[]
  error: string | null
  /** `sin_plan_valido` y compañía, del `result_json` del padre: terminar en silencio parecería éxito. */
  reason: string | null
  topics: MatrixTopic[] | null
  /** Solo las filas con `updated_at > since`: la matriz entera cada 3 s serían ~150 kB por sondeo. */
  items: ContentMatrixItem[]
}

type ChildJob = {
  status: AiJobStatus
  parent_job_id: string | null
  content_matrix_item_id: string | null
}

const LIVE: AiJobStatus[] = ['pending', 'processing']

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Next 16: los params de ruta son asincrónicos.
  const { id } = await params

  const ctx = await getEffectiveUser()
  if (!ctx) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!canManageMatrices(ctx.appUser.role)) return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })

  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: matrix, error: matrixError } = await supabase
    .from('content_matrices')
    .select('id, topics_json')
    .eq('id', id)
    .maybeSingle()
  if (matrixError) {
    console.error('[matrices/generation] leer matriz', matrixError.message)
    return NextResponse.json({ error: 'No se pudo leer la matriz' }, { status: 500 })
  }
  if (!matrix) return NextResponse.json({ error: 'Matriz no encontrada' }, { status: 404 })

  // **El padre más reciente y solo ese**: sin esto, una generación que falló en septiembre dejaría la
  // franja roja para siempre y sus hijos fallidos inflarían los contadores de la corrida siguiente.
  const { data: parent } = await admin
    .from('ai_jobs')
    .select('id, status, error_text, result_json')
    .eq('job_type', 'matrix_generate')
    .eq('content_matrix_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: childRows } = await admin
    .from('ai_jobs')
    .select('status, parent_job_id, content_matrix_item_id')
    .eq('job_type', 'matrix_item_write')
    .eq('content_matrix_id', id)
  const children = (childRows ?? []) as ChildJob[]

  // Los contadores son de los hijos DE ESE padre; los `matrix_item_write` sueltos (los de
  // "Regenerar") solo alimentan `writingItemIds`.
  const own = parent ? children.filter((c) => c.parent_job_id === parent.id) : []
  const done = own.filter((c) => c.status === 'completed').length
  const failed = own.filter((c) => c.status === 'failed').length

  const writingItemIds = children
    .filter((c) => LIVE.includes(c.status) && c.content_matrix_item_id)
    .map((c) => c.content_matrix_item_id as string)

  // `failed` es un estado propio porque un padre fallido no está ni `pending` ni `processing`: sin él
  // el editor mostraría "terminado" ante un fallo. El sondeo sigue vivo mientras haya un hijo vivo,
  // incluso si es una regeneración suelta — si no, "Regenerar" no refrescaría nunca la pieza.
  let phase: Phase = 'idle'
  if (parent && LIVE.includes(parent.status as AiJobStatus)) phase = 'planning'
  else if (parent?.status === 'failed') phase = 'failed'
  else if (writingItemIds.length > 0) phase = 'writing'

  const result = (parent?.result_json ?? null) as { reason?: unknown; skipped?: unknown } | null
  const reason = typeof result?.reason === 'string'
    ? result.reason
    : typeof result?.skipped === 'string' ? result.skipped : null

  const sinceRaw = req.nextUrl.searchParams.get('since')
  // Una marca de agua ilegible se ignora (se devuelve todo) en vez de romper la consulta.
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? sinceRaw : null

  let itemsQuery = supabase
    .from('content_matrix_items')
    .select('*')
    .eq('matrix_id', id)
    .order('updated_at', { ascending: true })
  if (since) itemsQuery = itemsQuery.gt('updated_at', since)
  const { data: items, error: itemsError } = await itemsQuery
  if (itemsError) {
    console.error('[matrices/generation] leer piezas', itemsError.message)
    return NextResponse.json({ error: 'No se pudieron leer las piezas' }, { status: 500 })
  }

  const body: GenerationProgress = {
    phase,
    total: own.length,
    done,
    failed,
    writingItemIds,
    error: parent?.status === 'failed' ? (parent.error_text ?? null) : null,
    reason,
    topics: (matrix.topics_json ?? null) as MatrixTopic[] | null,
    items: (items ?? []) as ContentMatrixItem[],
  }
  return NextResponse.json(body)
}
