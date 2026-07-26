import type { SupabaseClient } from '@supabase/supabase-js'

export type AiJobStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

export interface AiJobRow {
  id: string
  job_type: string
  status: AiJobStatus
  priority: number
  requirement_id: string | null
  client_id: string | null
  triggered_by: string | null
  parent_job_id: string | null
  input_json: Record<string, unknown>
  result_json: Record<string, unknown> | null
  error_text: string | null
  attempts: number
  max_attempts: number
  cost_usd_cents: number | null
  invoice_id: string | null
  locked_at: string | null
  locked_by: string | null
  scheduled_for: string
  started_at: string | null
  finished_at: string | null
  created_at: string
}

export interface AiHandlerCtx {
  job: AiJobRow
  supabase: SupabaseClient
  logEvent: (eventType: string, payload?: Record<string, unknown>) => Promise<void>
}

export type AiHandler<I = Record<string, unknown>, O = Record<string, unknown>> = (
  ctx: AiHandlerCtx,
  input: I,
) => Promise<O>
