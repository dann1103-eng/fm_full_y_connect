-- 0091_whatsapp_integration.sql
-- Integración WhatsApp Cloud API + Bot IA — Fase 1.
-- Tablas: client_whatsapp_contacts, wa_conversations, wa_messages, wa_bot_configs.
-- Toggle wa_bot_enabled en clients. Dedupe de ai_jobs por conversación.
-- RLS para staff interno. Realtime para inbox. Bucket whatsapp-media.

begin;

-- ────────────────────────────────────────────────────────────
-- 1) Toggle global del bot por cliente
-- ────────────────────────────────────────────────────────────
alter table public.clients
  add column if not exists wa_bot_enabled boolean not null default true;

-- ────────────────────────────────────────────────────────────
-- 2) Contactos WhatsApp por cliente (varios números posibles)
-- ────────────────────────────────────────────────────────────
create table if not exists public.client_whatsapp_contacts (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  phone_e164   text not null,
  display_name text,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (phone_e164)
);

create index if not exists client_whatsapp_contacts_client_idx
  on public.client_whatsapp_contacts(client_id);

-- ────────────────────────────────────────────────────────────
-- 3) Conversaciones WhatsApp (una por número externo)
-- ────────────────────────────────────────────────────────────
create table if not exists public.wa_conversations (
  id               uuid primary key default gen_random_uuid(),
  phone_e164       text not null unique,
  client_id        uuid references public.clients(id) on delete set null,
  contact_id       uuid references public.client_whatsapp_contacts(id) on delete set null,
  display_name     text,
  bot_paused       boolean not null default false,
  paused_by        uuid references public.users(id),
  paused_at        timestamptz,
  last_inbound_at  timestamptz,
  last_message_at  timestamptz,
  last_message_preview text,
  unread_count     int not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists wa_conversations_client_idx
  on public.wa_conversations(client_id);
create index if not exists wa_conversations_last_msg_idx
  on public.wa_conversations(last_message_at desc nulls last);

-- ────────────────────────────────────────────────────────────
-- 4) Mensajes WhatsApp
-- ────────────────────────────────────────────────────────────
create table if not exists public.wa_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.wa_conversations(id) on delete cascade,
  direction       text not null check (direction in ('inbound','outbound')),
  wamid           text unique,
  msg_type        text not null check (msg_type in
    ('text','image','audio','video','document','sticker','location','interactive','template','system')),
  body            text,
  media_path      text,
  media_mime      text,
  sent_by         text check (sent_by in ('bot','staff','system')),
  staff_user_id   uuid references public.users(id),
  ai_job_id       uuid references public.ai_jobs(id) on delete set null,
  wa_status       text check (wa_status in ('sent','delivered','read','failed')),
  wa_error_json   jsonb,
  processed_at    timestamptz,
  raw_json        jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists wa_messages_conv_created_idx
  on public.wa_messages(conversation_id, created_at desc);

create index if not exists wa_messages_unprocessed_idx
  on public.wa_messages(conversation_id)
  where processed_at is null and direction = 'inbound';

-- ────────────────────────────────────────────────────────────
-- 5) Configuración editable del bot (singleton id=1)
-- ────────────────────────────────────────────────────────────
create table if not exists public.wa_bot_configs (
  id               int primary key default 1 check (id = 1),
  system_prompt    text not null,
  model            text not null default 'claude-sonnet-4-6',
  temperature      numeric(3,2) not null default 0.3,
  max_tokens       int not null default 1024,
  enabled_tools    text[] not null default array[
    'get_client_context','get_active_requirements','get_requirement_status',
    'get_unpaid_invoices','get_next_publications','handoff_to_human'
  ],
  debounce_seconds int not null default 8,
  history_window   int not null default 20,
  updated_by       uuid references public.users(id),
  updated_at       timestamptz not null default now()
);

insert into public.wa_bot_configs (id, system_prompt)
values (
  1,
  'Eres el asistente de WhatsApp de FM Communication Solutions. Responde siempre en español, con tono cercano y profesional. Usa las herramientas disponibles para obtener información real del CRM antes de responder. Si la pregunta está fuera de tu alcance o el cliente pide hablar con una persona, usa handoff_to_human y avisa al cliente que un miembro del equipo le responderá.'
)
on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────────
-- 6) Dedupe de jobs whatsapp_reply por conversación
-- ────────────────────────────────────────────────────────────
alter table public.ai_jobs
  add column if not exists wa_conversation_id uuid references public.wa_conversations(id) on delete set null;

create unique index if not exists ai_jobs_one_pending_per_wa_conv
  on public.ai_jobs(wa_conversation_id)
  where status = 'pending' and job_type = 'whatsapp_reply';

-- ────────────────────────────────────────────────────────────
-- 7) RLS — solo staff interno ve la bandeja; bot config solo admin
-- ────────────────────────────────────────────────────────────
alter table public.client_whatsapp_contacts enable row level security;
alter table public.wa_conversations         enable row level security;
alter table public.wa_messages              enable row level security;
alter table public.wa_bot_configs           enable row level security;

drop policy if exists wa_contacts_staff_read on public.client_whatsapp_contacts;
create policy wa_contacts_staff_read on public.client_whatsapp_contacts
  for select using (public.is_agency_user());

drop policy if exists wa_conversations_staff_read on public.wa_conversations;
create policy wa_conversations_staff_read on public.wa_conversations
  for select using (public.is_agency_user());

drop policy if exists wa_messages_staff_read on public.wa_messages;
create policy wa_messages_staff_read on public.wa_messages
  for select using (public.is_agency_user());

drop policy if exists wa_bot_configs_admin_read on public.wa_bot_configs;
create policy wa_bot_configs_admin_read on public.wa_bot_configs
  for select using (public.is_admin());

drop policy if exists wa_bot_configs_admin_write on public.wa_bot_configs;
create policy wa_bot_configs_admin_write on public.wa_bot_configs
  for update using (public.is_admin()) with check (public.is_admin());

-- Las server actions usan adminClient (bypass RLS) para inserts del webhook
-- y respuestas del staff. Las policies anteriores son defensa en profundidad para SELECT.

-- ────────────────────────────────────────────────────────────
-- 8) Realtime
-- ────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'wa_conversations'
    ) then
      execute 'alter publication supabase_realtime add table public.wa_conversations';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'wa_messages'
    ) then
      execute 'alter publication supabase_realtime add table public.wa_messages';
    end if;
  end if;
end $$;

-- ────────────────────────────────────────────────────────────
-- 9) Bucket privado para multimedia de WhatsApp
-- ────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('whatsapp-media', 'whatsapp-media', false)
on conflict (id) do nothing;

drop policy if exists "Staff read whatsapp-media" on storage.objects;
create policy "Staff read whatsapp-media" on storage.objects
  for select
  using (bucket_id = 'whatsapp-media' and public.is_agency_user());

-- ────────────────────────────────────────────────────────────
-- 10) Trigger para mantener updated_at en wa_bot_configs
-- ────────────────────────────────────────────────────────────
create or replace function public.wa_bot_configs_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists wa_bot_configs_set_updated_at on public.wa_bot_configs;
create trigger wa_bot_configs_set_updated_at
  before update on public.wa_bot_configs
  for each row execute function public.wa_bot_configs_touch_updated_at();

commit;
