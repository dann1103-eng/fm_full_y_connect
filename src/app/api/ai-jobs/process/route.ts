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
export const maxDuration = 60

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
