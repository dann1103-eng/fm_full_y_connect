/**
 * Disparo de baja latencia del runner de `ai_jobs`.
 *
 * Estaba duplicado en `api/whatsapp/webhook/route.ts` y en `actions/whatsappNotify.ts` con parámetros
 * distintos; un tercer duplicado sería el que se desincroniza. Los llamadores pasan sus valores.
 *
 * Es **fire-and-forget**: no se espera la respuesta (el webhook tiene que devolverle el 200 a Meta
 * rápido) y cualquier error se traga y se loguea — el cron del minuto es el respaldo.
 */
export async function triggerJobRunner(opts: { max: number; waitMs: number }): Promise<void> {
  const secret = process.env.AI_JOBS_TRIGGER_SECRET
  if (!secret) return
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'https://www.fullefm.site'
  // No await: dispara y olvida. `keepalive` para que la petición sobreviva al fin de la función.
  void fetch(`${base}/api/ai-jobs/process?max=${opts.max}&wait=${opts.waitMs}`, {
    method: 'POST',
    headers: { 'x-trigger-secret': secret, 'content-type': 'application/json' },
    body: '{}',
    cache: 'no-store',
    keepalive: true,
  }).catch((err) => console.warn('[ai/trigger] no se pudo disparar el runner', err))
}
