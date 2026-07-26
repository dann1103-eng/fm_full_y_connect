-- 0082_ai_jobs.sql
-- Infraestructura base para jobs de IA (sub-proyecto #1).
-- Añade el rol 'agent', el usuario FM Bot, las tablas ai_jobs y ai_job_events,
-- la RPC claim_ai_job, RLS y publicación realtime.

-- ────────────────────────────────────────────────────────────
-- 1) Ampliar CHECK constraint de users.role para aceptar 'agent'
-- ────────────────────────────────────────────────────────────
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('admin','supervisor','operator','client','agent'));

-- ────────────────────────────────────────────────────────────
-- 2) El usuario FM Bot se crea en la migración 0083_ai_jobs_bot_user_fix.sql,
--    porque public.users.id tiene FK a auth.users.id y hay que insertar primero
--    la fila en auth.users. Se separa para mantener idempotencia.
-- ────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────
-- 3) Tabla principal de jobs
-- ────────────────────────────────────────────────────────────
create table if not exists public.ai_jobs (
  id              uuid primary key default gen_random_uuid(),
  job_type        text not null,
  status          text not null default 'pending'
                  check (status in ('pending','processing','completed','failed','cancelled')),
  priority        smallint not null default 5,
  requirement_id  uuid references public.requirements(id) on delete cascade,
  client_id       uuid references public.clients(id)      on delete set null,
  triggered_by    uuid references public.users(id),
  parent_job_id   uuid references public.ai_jobs(id) on delete set null,
  input_json      jsonb not null default '{}'::jsonb,
  result_json     jsonb,
  error_text      text,
  attempts        smallint not null default 0,
  max_attempts    smallint not null default 3,
  cost_usd_cents  integer,
  locked_at       timestamptz,
  locked_by       text,
  scheduled_for   timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists ai_jobs_pending_idx
  on public.ai_jobs (priority, scheduled_for)
  where status = 'pending';

create index if not exists ai_jobs_requirement_idx
  on public.ai_jobs (requirement_id);

create index if not exists ai_jobs_status_idx
  on public.ai_jobs (status, created_at desc);

-- ────────────────────────────────────────────────────────────
-- 4) Tabla de eventos (audit log por job)
-- ────────────────────────────────────────────────────────────
create table if not exists public.ai_job_events (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.ai_jobs(id) on delete cascade,
  event_type  text not null,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists ai_job_events_job_idx
  on public.ai_job_events (job_id, created_at);

-- ────────────────────────────────────────────────────────────
-- 5) RLS — solo admins pueden leer; el worker usa service role (bypass)
-- ────────────────────────────────────────────────────────────
alter table public.ai_jobs       enable row level security;
alter table public.ai_job_events enable row level security;

drop policy if exists ai_jobs_admin_read on public.ai_jobs;
create policy ai_jobs_admin_read
  on public.ai_jobs
  for select
  using (public.is_admin());

drop policy if exists ai_job_events_admin_read on public.ai_job_events;
create policy ai_job_events_admin_read
  on public.ai_job_events
  for select
  using (public.is_admin());

-- ────────────────────────────────────────────────────────────
-- 6) Realtime para la página admin
-- ────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'ai_jobs'
    ) then
      execute 'alter publication supabase_realtime add table public.ai_jobs';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'ai_job_events'
    ) then
      execute 'alter publication supabase_realtime add table public.ai_job_events';
    end if;
  end if;
end $$;

-- ────────────────────────────────────────────────────────────
-- 7) RPC para que el worker reclame jobs atómicamente
--    Usa for update skip locked → seguro para múltiples workers.
-- ────────────────────────────────────────────────────────────
create or replace function public.claim_ai_job(
  p_worker_id text,
  p_job_types text[] default null
)
returns public.ai_jobs
language plpgsql
security definer
as $$
declare
  j public.ai_jobs;
begin
  update public.ai_jobs
     set status      = 'processing',
         locked_at   = now(),
         locked_by   = p_worker_id,
         started_at  = coalesce(started_at, now()),
         attempts    = attempts + 1
   where id = (
     select id
       from public.ai_jobs
      where status = 'pending'
        and scheduled_for <= now()
        and (p_job_types is null or job_type = any(p_job_types))
      order by priority asc, scheduled_for asc
      for update skip locked
      limit 1
   )
   returning * into j;

  return j;
end
$$;

revoke all on function public.claim_ai_job(text, text[]) from public;
grant execute on function public.claim_ai_job(text, text[]) to service_role;
