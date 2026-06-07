'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireUser } from '@/lib/auth/require-user'

export interface EnqueueAiJobInput {
  jobType: string
  requirementId?: string | null
  clientId?: string | null
  payload?: Record<string, unknown>
  priority?: number
  scheduledFor?: string
  parentJobId?: string | null
  maxAttempts?: number
}

export type EnqueueAiJobResult =
  | { ok: true; jobId: string }
  | { ok: false; error: string }

/**
 * Encola un job de IA. Usa admin client porque RLS de ai_jobs solo permite
 * lectura a admins; los operadores también deben poder encolar.
 *
 * No espera al worker — devuelve inmediatamente con el jobId.
 */
export async function enqueueAiJob(input: EnqueueAiJobInput): Promise<EnqueueAiJobResult> {
  try {
    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) {
      return { ok: false, error: 'No autenticado' }
    }

    if (!input.jobType || typeof input.jobType !== 'string') {
      return { ok: false, error: 'jobType es requerido' }
    }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('ai_jobs')
      .insert({
        job_type: input.jobType,
        status: 'pending',
        priority: input.priority ?? 5,
        requirement_id: input.requirementId ?? null,
        client_id: input.clientId ?? null,
        triggered_by: auth.user.id,
        parent_job_id: input.parentJobId ?? null,
        input_json: input.payload ?? {},
        max_attempts: input.maxAttempts ?? 3,
        scheduled_for: input.scheduledFor ?? new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error || !data) {
      return { ok: false, error: error?.message ?? 'No se pudo encolar el job' }
    }

    await admin.from('ai_job_events').insert({
      job_id: data.id,
      event_type: 'enqueued',
      payload: {
        job_type: input.jobType,
        triggered_by: auth.user.id,
        requirement_id: input.requirementId ?? null,
      },
    })

    return { ok: true, jobId: data.id }
  } catch (e) {
    console.error('enqueueAiJob failed:', e)
    return { ok: false, error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

