/**
 * Cron diario que convierte piezas de matrices aprobadas en requerimientos del pipeline,
 * `lead_days` antes de su fecha de entrega.
 *
 * Diseño: docs/superpowers/specs/2026-09-17-creador-de-matrices-bloque-2-design.md
 * Auth: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron) o `x-trigger-secret`.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { convertMatrixItem, type CycleRequirementsCache } from '@/lib/data/matrix-convert'
import { selectItemsToConvert, CATCHUP_DAYS, type ConvertibleMatrix } from '@/lib/domain/matrix'
import { today, addDaysString } from '@/lib/domain/dates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Cota barata en SQL: el tope de lead_days es 30. */
const WINDOW_DAYS = 30
const SCAN_LIMIT = 300
const CONVERT_LIMIT = 80

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  const triggerSecret = process.env.AI_JOBS_TRIGGER_SECRET
  const auth = request.headers.get('authorization')
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true
  if (triggerSecret && request.headers.get('x-trigger-secret') === triggerSecret) return true
  return false
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('unauthorized', { status: 401 })

  const admin = createAdminClient()
  const t = today()

  // El filtro de matriz aprobada va en SQL a propósito: si no, las piezas viejas de matrices en
  // borrador o cerradas se acumulan en la cabeza del ranking y, pasadas SCAN_LIMIT filas, el
  // barrido dejaría de encontrar piezas convertibles sin dar error.
  // Si PostgREST rechazara el filtro sobre el embed aliaseado (`matrix.status`), la forma
  // equivalente sin alias es `content_matrices!inner(id, status, lead_days)` con
  // `.eq('content_matrices.status', 'approved')` — la que ya usa `src/lib/ai/tools.ts`.
  const { data, error } = await admin
    .from('content_matrix_items')
    .select('id, matrix_id, deadline, status, created_at, matrix:content_matrices!inner(id, status, lead_days)')
    .eq('status', 'planned')
    .eq('matrix.status', 'approved')
    .gte('deadline', addDaysString(t, -CATCHUP_DAYS))
    .lte('deadline', addDaysString(t, WINDOW_DAYS))
    .order('deadline', { ascending: true })
    .limit(SCAN_LIMIT)

  if (error) {
    console.error('[matrices/convert] query', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  type Row = { id: string; matrix_id: string; deadline: string; status: 'planned'; created_at: string; matrix: ConvertibleMatrix }
  const rows = (data ?? []) as unknown as Row[]
  const matrices = new Map<string, ConvertibleMatrix>(rows.map((r) => [r.matrix_id, r.matrix]))
  const selected = selectItemsToConvert(rows, matrices, t, CONVERT_LIMIT)

  const cache: CycleRequirementsCache = new Map()
  const details: Array<{ id: string; kind: string; reason?: string }> = []
  let converted = 0, blocked = 0, skipped = 0

  // Secuencial a propósito: en paralelo dos piezas del mismo ciclo calcularían el cupo sobre el
  // mismo estado y ambas nacerían dentro de plan.
  for (const it of selected) {
    const r = await convertMatrixItem(admin, it.id, { cache })
    if (r.kind === 'converted') converted++
    else if (r.kind === 'blocked') blocked++
    else skipped++
    if (details.length < 50) details.push({ id: it.id, kind: r.kind, reason: 'reason' in r ? r.reason : undefined })
  }

  console.log(`[matrices/convert] ${t} scanned=${rows.length} selected=${selected.length} converted=${converted} blocked=${blocked} skipped=${skipped}`)
  return NextResponse.json({ ok: true, today: t, scanned: rows.length, selected: selected.length, converted, blocked, skipped, details })
}

// Vercel Cron manda GET.
export async function GET(request: Request) {
  return POST(request)
}
