/**
 * Cron diario que ENCOLA recordatorios de facturas por vencer.
 *
 * Solo busca y encola — el trabajo pesado (regenerar enlace, renderizar PDF,
 * subirlo a Meta, enviar) lo hace el handler `invoice_due_reminder` a través
 * del runner, con sus reintentos y su watchdog.
 *
 * Autenticación: `Authorization: Bearer <CRON_SECRET>` (lo envía Vercel Cron)
 * o header `x-trigger-secret` con AI_JOBS_TRIGGER_SECRET.
 * A diferencia de /api/ai-jobs/process, aquí NO se acepta el secret por query
 * param: ese fallback está marcado como deuda a eliminar en ese archivo.
 *
 * Diseño: docs/superpowers/specs/2026-07-25-recordatorio-factura-por-vencer-design.md
 */
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createWaAdminClient } from '@/lib/whatsapp/db'
import { selectRemindersToSend, type ReminderCandidate } from '@/lib/billing/due-reminders'
import { today, addDaysString } from '@/lib/domain/dates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Prioridad por debajo de whatsapp_reply (5): el bot en vivo va primero. */
const REMINDER_PRIORITY = 7

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET
  const triggerSecret = process.env.AI_JOBS_TRIGGER_SECRET

  const auth = request.headers.get('authorization')
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true
  if (triggerSecret && request.headers.get('x-trigger-secret') === triggerSecret) return true
  return false
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse('unauthorized', { status: 401 })
  }

  const admin = createAdminClient()
  const wa = createWaAdminClient()

  // Ventana de 3 días. Es más ancha que "exactamente T-3" a propósito: si el
  // cron falla un día, la factura sigue siendo elegible al siguiente. El
  // marcador due_reminder_sent_at garantiza un único envío.
  const from = addDaysString(today(), 1)
  const to = addDaysString(today(), 3)

  const { data: invoices, error } = await admin
    .from('invoices')
    .select('id, client_id, due_date')
    .eq('status', 'issued')
    .is('payment_date', null)
    .is('due_reminder_sent_at', null)
    .gte('due_date', from)
    .lte('due_date', to)
    .order('due_date', { ascending: true })
    .limit(200)

  if (error) {
    console.error('[due-reminders] query facturas', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const rows = invoices ?? []
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, window: { from, to }, candidates: 0, enqueued: 0 })
  }

  // Teléfono destino por cliente: mismo orden canónico que whatsappNotify
  // (is_primary no tiene constraint de unicidad, así que el orden importa).
  const clientIds = Array.from(new Set(rows.map((r) => r.client_id)))
  const { data: contacts } = await wa
    .from('client_whatsapp_contacts')
    .select('client_id, phone_e164, is_primary, created_at')
    .in('client_id', clientIds)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  const phoneByClient = new Map<string, string>()
  for (const c of (contacts ?? []) as Array<{ client_id: string; phone_e164: string }>) {
    if (!phoneByClient.has(c.client_id)) phoneByClient.set(c.client_id, c.phone_e164)
  }

  const candidates: ReminderCandidate[] = rows.map((r) => ({
    invoiceId: r.id as string,
    clientId: r.client_id as string,
    phoneE164: phoneByClient.get(r.client_id as string) ?? null,
    dueDate: r.due_date as string,
  }))

  const toSend = selectRemindersToSend(candidates)
  const skippedNoPhone = candidates.filter((c) => !c.phoneE164).length
  const throttled = candidates.length - toSend.length - skippedNoPhone

  // Insert fila por fila: el índice único parcial lanza 23505 y, en un insert
  // por lote, un solo conflicto abortaría todo el batch.
  let enqueued = 0
  for (const r of toSend) {
    const { error: insErr } = await admin.from('ai_jobs').insert({
      job_type: 'invoice_due_reminder',
      status: 'pending',
      priority: REMINDER_PRIORITY,
      client_id: r.clientId,
      invoice_id: r.invoiceId,
      input_json: { invoiceId: r.invoiceId, phoneE164: r.phoneE164, clientId: r.clientId },
      scheduled_for: new Date().toISOString(),
    })
    if (insErr) {
      // 23505 = ya hay un recordatorio pending/processing para esa factura.
      if (insErr.code !== '23505') {
        console.error('[due-reminders] insert job', r.invoiceId, insErr.message)
      }
      continue
    }
    enqueued++
  }

  return NextResponse.json({
    ok: true,
    window: { from, to },
    candidates: candidates.length,
    enqueued,
    skippedNoPhone,
    throttled,
  })
}

// GET — Vercel Cron envía GET por defecto.
export async function GET(request: Request) {
  return POST(request)
}
