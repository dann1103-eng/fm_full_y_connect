import { createAdminClient } from '@/lib/supabase/admin'
import { createWaAdminClient } from '@/lib/whatsapp/db'
import type { SupabaseClient } from '@supabase/supabase-js'
import { whatsappReplyHandler } from './handlers/whatsappReply'
import { whatsappTemplateHandler } from './handlers/whatsappTemplate'
import { invoiceDueReminderHandler } from './handlers/invoiceDueReminder'
import type { AiHandler, AiHandlerCtx, AiJobRow } from './types'

/**
 * Registry de handlers ejecutables desde el Vercel runtime
 * (sustituye al worker Node aparte).
 */
const HANDLERS: Record<string, AiHandler> = {
  whatsapp_reply: whatsappReplyHandler as AiHandler,
  whatsapp_template: whatsappTemplateHandler as AiHandler,
  // No lleva prefijo whatsapp_ a propósito: así el runner le pasa el cliente
  // TIPADO (invoices/clients) y el handler instancia el de wa_* por su cuenta.
  invoice_due_reminder: invoiceDueReminderHandler as AiHandler,
}

const KNOWN_JOB_TYPES = Object.keys(HANDLERS)
const WORKER_ID = `vercel-${process.env.VERCEL_REGION ?? 'local'}-${process.pid}`

async function logEvent(
  supabase: SupabaseClient,
  jobId: string,
  eventType: string,
  payload?: Record<string, unknown>,
) {
  await supabase.from('ai_job_events').insert({
    job_id: jobId,
    event_type: eventType,
    payload: payload ?? null,
  })
}

async function claimNext(supabase: SupabaseClient): Promise<AiJobRow | null> {
  const { data, error } = await supabase.rpc('claim_ai_job', {
    p_worker_id: WORKER_ID,
    p_job_types: KNOWN_JOB_TYPES,
  })
  if (error) {
    console.error('[ai/runner] claim_ai_job RPC failed', error.message)
    return null
  }
  const job = data as AiJobRow | null
  if (!job?.id) return null
  return job
}

async function completeJob(supabase: SupabaseClient, jobId: string, result: Record<string, unknown>) {
  await supabase
    .from('ai_jobs')
    .update({
      status: 'completed',
      result_json: result,
      finished_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
    })
    .eq('id', jobId)
  await logEvent(supabase, jobId, 'completed', { result })
}

async function failJob(supabase: SupabaseClient, job: AiJobRow, error: Error) {
  const willRetry = job.attempts < job.max_attempts
  if (willRetry) {
    const backoffMs = Math.min(60_000, 2 ** job.attempts * 1000)
    const scheduledFor = new Date(Date.now() + backoffMs).toISOString()
    await supabase
      .from('ai_jobs')
      .update({
        status: 'pending',
        scheduled_for: scheduledFor,
        locked_at: null,
        locked_by: null,
        error_text: error.message,
      })
      .eq('id', job.id)
    await logEvent(supabase, job.id, 'released', { error: error.message, retry_at: scheduledFor })
  } else {
    await supabase
      .from('ai_jobs')
      .update({
        status: 'failed',
        error_text: error.message,
        finished_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
      })
      .eq('id', job.id)
    await logEvent(supabase, job.id, 'failed', { error: error.message })
  }
}

/**
 * Procesa hasta `maxJobs` jobs elegibles (scheduled_for <= now).
 * Si el siguiente job está agendado dentro de los próximos `waitForUpcomingMs` ms,
 * espera y lo procesa también — esto da baja latencia al webhook que dispara
 * esta ruta inmediatamente después de encolar con un debounce de ~8s.
 *
 * Devuelve cuántos jobs fueron procesados (exitosos o no).
 */
export async function runJobs(opts?: {
  maxJobs?: number
  waitForUpcomingMs?: number
}): Promise<{ processed: number; details: Array<{ id: string; ok: boolean }> }> {
  const maxJobs = opts?.maxJobs ?? 5
  const waitForUpcomingMs = opts?.waitForUpcomingMs ?? 0
  const supabase = createAdminClient()
  const waSupabase = createWaAdminClient()

  const details: Array<{ id: string; ok: boolean }> = []

  // Espera opcional a que un job próximo sea elegible (caso webhook → ruta inmediata).
  if (waitForUpcomingMs > 0) {
    const { data } = await supabase
      .from('ai_jobs')
      .select('scheduled_for, status')
      .eq('status', 'pending')
      .order('scheduled_for', { ascending: true })
      .limit(1)
      .maybeSingle()
    const nextAt = (data as { scheduled_for: string } | null)?.scheduled_for
    if (nextAt) {
      const waitMs = new Date(nextAt).getTime() - Date.now()
      if (waitMs > 0 && waitMs <= waitForUpcomingMs) {
        await new Promise((r) => setTimeout(r, waitMs + 250))
      }
    }
  }

  for (let i = 0; i < maxJobs; i++) {
    const job = await claimNext(supabase)
    if (!job) break

    const handler = HANDLERS[job.job_type]
    if (!handler) {
      await failJob(supabase, job, new Error(`No handler registrado para job_type='${job.job_type}'`))
      details.push({ id: job.id, ok: false })
      continue
    }

    // Los handlers de WhatsApp leen/escriben tablas wa_* que no están en el tipo Database;
    // les pasamos el admin client sin tipar para evitar conflictos.
    const ctx: AiHandlerCtx = {
      job,
      supabase: job.job_type.startsWith('whatsapp_') ? waSupabase : supabase,
      logEvent: (type, payload) => logEvent(supabase, job.id, type, payload),
    }

    try {
      const result = await handler(ctx, job.input_json)
      await completeJob(supabase, job.id, result)
      details.push({ id: job.id, ok: true })
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      console.error('[ai/runner] handler failed', { job_id: job.id, error: err.message })
      await failJob(supabase, job, err)
      details.push({ id: job.id, ok: false })
    }
  }

  return { processed: details.length, details }
}
