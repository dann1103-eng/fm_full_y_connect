/**
 * Cron diario que convierte piezas de matrices aprobadas en requerimientos del pipeline,
 * `lead_days` antes de su fecha de entrega.
 *
 * Diseño: docs/superpowers/specs/2026-09-17-creador-de-matrices-bloque-2-design.md
 * Auth: `Authorization: Bearer <CRON_SECRET>` (Vercel Cron) o `x-trigger-secret`.
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { convertMatrixItem, createConvertCache } from '@/lib/data/matrix-convert'
import { selectItemsToConvert, CATCHUP_DAYS, type ConvertibleMatrix } from '@/lib/domain/matrix'
import { today, addDaysString } from '@/lib/domain/dates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Cota barata en SQL: el tope de lead_days es 30. */
const WINDOW_DAYS = 30
const SCAN_LIMIT = 300
const CONVERT_LIMIT = 80
/**
 * Presupuesto de tiempo, 15 s por debajo de `maxDuration`. Cada conversión son 4–6 viajes a la
 * base, así que 80 piezas pueden pasarse de los 60 s. Si la plataforma matara la función entre el
 * insert del requerimiento y el update de la pieza, el requerimiento quedaría vivo con la pieza
 * todavía `planned` y el barrido de mañana crearía un SEGUNDO requerimiento (el índice único no lo
 * ataja: el id es distinto). Mejor cortar limpio y dejar el resto para la corrida siguiente.
 */
const TIME_BUDGET_MS = 45_000

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

  const cache = createConvertCache()
  const details: Array<{ id: string; kind: string; reason?: string }> = []
  let converted = 0, blocked = 0, skipped = 0, processed = 0
  let stoppedEarly = false
  const until = new Date().getTime() + TIME_BUDGET_MS

  // Secuencial a propósito: en paralelo dos piezas del mismo ciclo calcularían el cupo sobre el
  // mismo estado y ambas nacerían dentro de plan.
  for (const it of selected) {
    if (new Date().getTime() > until) { stoppedEarly = true; break }
    let r: Awaited<ReturnType<typeof convertMatrixItem>>
    try {
      r = await convertMatrixItem(admin, it.id, { cache })
    } catch (e) {
      // Un throw inesperado no puede tumbar la corrida entera y perder los contadores.
      const message = e instanceof Error ? e.message : String(e)
      console.error('[matrices/convert] excepción convirtiendo', it.id, message)
      r = { kind: 'skipped', reason: message }
    }
    processed++
    if (r.kind === 'converted') converted++
    else if (r.kind === 'blocked') blocked++
    else skipped++
    if (details.length < 50) details.push({ id: it.id, kind: r.kind, reason: 'reason' in r ? r.reason : undefined })
  }

  const remaining = selected.length - processed
  const summary = `scanned=${rows.length} selected=${selected.length} converted=${converted} blocked=${blocked} skipped=${skipped} stoppedEarly=${stoppedEarly} remaining=${remaining}`
  console.log(`[matrices/convert] ${t} ${summary}`)
  // Una corrida donde no se convirtió nada teniendo piezas elegibles es señal de que algo va mal.
  if (selected.length > 0 && converted === 0) console.error(`[matrices/convert] ninguna conversión ${t} ${summary}`)

  return NextResponse.json({
    ok: true, today: t, scanned: rows.length, selected: selected.length,
    converted, blocked, skipped,
    stopped_early: stoppedEarly, remaining,
    truncated: details.length < selected.length,
    details,
  })
}

// Vercel Cron manda GET.
export async function GET(request: Request) {
  return POST(request)
}
