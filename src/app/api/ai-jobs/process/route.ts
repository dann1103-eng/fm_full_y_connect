/**
 * Endpoint que ejecuta jobs de la cola `ai_jobs` desde el runtime de Vercel.
 *
 * Se invoca desde:
 *  - Vercel Cron (cada minuto) — para procesamiento eventual.
 *  - Trigger Postgres → pg_net (migración 0092) — disparo inmediato al encolar.
 *  - El propio webhook de WhatsApp (fetch fire-and-forget) — para baja latencia.
 *
 * Autenticación: header `x-trigger-secret` debe igualar AI_JOBS_TRIGGER_SECRET,
 * o el caller debe llevar el header `Authorization: Bearer <CRON_SECRET>` que
 * Vercel Cron envía automáticamente.
 */
import { NextResponse } from 'next/server'
import { runJobs } from '@/lib/ai/runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/**
 * 180 s, con `RUNNER_BUDGET_MS = 45_000` de `runJobs` como corte para RECLAMAR: un job reclamado a los
 * 44,9 s tiene que poder terminar. Un hijo de matriz tarda 10–20 s y un padre con un plan grande 40–80 s de
 * modelo; con 60 s la plataforma los mataba a media llamada, y si era el último intento el job quedaba
 * `processing` para siempre (el watchdog de 0124 no rescata intentos agotados).
 *
 * **No más de 180**: `claim_ai_job` fija `locked_at` al reclamar y el watchdog de 0124 rescata a los
 * 5 min (300 s). Una función que corriera cerca de 300 s con un job reclamado al principio vería ese job
 * reclamado OTRA vez por otra invocación mientras sigue vivo: doble llamada al modelo o doble mensaje de
 * WhatsApp. 180 deja dos minutos de margen aun con un job reclamado en el segundo 0.
 */
export const maxDuration = 180

function isAuthorized(request: Request): boolean {
  const url = new URL(request.url)
  const secret = process.env.AI_JOBS_TRIGGER_SECRET
  const cronSecret = process.env.CRON_SECRET

  // Vercel Cron envía Authorization: Bearer <CRON_SECRET>
  const auth = request.headers.get('authorization')
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true

  // Header explícito (usado por el trigger Postgres y por el webhook interno)
  if (secret && request.headers.get('x-trigger-secret') === secret) return true

  // Query param para debug (no usar en producción) — eliminar después.
  if (secret && url.searchParams.get('secret') === secret) return true

  return false
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse('unauthorized', { status: 401 })
  }
  const url = new URL(request.url)
  const maxJobs = Number(url.searchParams.get('max') ?? '5')
  const waitForUpcomingMs = Number(url.searchParams.get('wait') ?? '0')

  try {
    const result = await runJobs({ maxJobs, waitForUpcomingMs })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[ai-jobs/process] runJobs failed', e)
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// GET — usado por Vercel Cron (envía GET por defecto).
export async function GET(request: Request) {
  return POST(request)
}
