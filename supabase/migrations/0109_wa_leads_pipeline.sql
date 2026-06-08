-- 0109_wa_leads_pipeline.sql
-- Añade campos de pipeline comercial a wa_leads:
--  - status: en qué etapa del funnel está el lead.
--  - assigned_to_user_id: comercial asignado (opcional).
--  - converted_to_client_id + converted_at: cuándo se convirtió a cliente real.
--  - rejected_reason: por qué se descartó.
--
-- También extiende la tool `handoff_to_human` para que marque el lead como
-- 'escalated' automáticamente cuando el bot escala. Eso lo hace el código
-- TS de tools.ts; aquí solo schema.

begin;

alter table public.wa_leads
  add column if not exists status text not null default 'active'
    check (status in ('active', 'escalated', 'converted', 'rejected', 'archived')),
  add column if not exists assigned_to_user_id uuid references public.users(id) on delete set null,
  add column if not exists converted_to_client_id uuid references public.clients(id) on delete set null,
  add column if not exists converted_at timestamptz,
  add column if not exists rejected_reason text,
  add column if not exists status_updated_at timestamptz not null default now(),
  add column if not exists status_updated_by uuid references public.users(id) on delete set null;

create index if not exists wa_leads_status_idx on public.wa_leads(status, created_at desc);
create index if not exists wa_leads_assigned_idx on public.wa_leads(assigned_to_user_id);

-- Trigger para mantener status_updated_at sincronizado.
create or replace function public.wa_leads_touch_status()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.status_updated_at := now();
  end if;
  return new;
end
$$;

drop trigger if exists wa_leads_status_trigger on public.wa_leads;
create trigger wa_leads_status_trigger
  before update on public.wa_leads
  for each row execute function public.wa_leads_touch_status();

commit;
