-- 0110_ai_jobs_tokens.sql
-- Tracking de tokens consumidos por cada ai_job para reportar costos del bot
-- de WhatsApp en /admin/whatsapp. cost_usd_cents ya existía desde 0082.

begin;

alter table public.ai_jobs
  add column if not exists tokens_input integer,
  add column if not exists tokens_output integer,
  add column if not exists tokens_cached integer;

create index if not exists ai_jobs_finished_month_idx
  on public.ai_jobs (job_type, finished_at desc)
  where finished_at is not null;

commit;
