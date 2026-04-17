-- ============================================================
-- FM CRM — Migration 0001: Initial schema
-- ============================================================

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ── users ────────────────────────────────────────────────────
-- Mirrors auth.users; role stored here for RLS + app logic
create table public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        text not null default 'operator'
                check (role in ('admin','operator')),
  created_at  timestamptz not null default now()
);

-- Sync new auth user → public.users (email only; name/role set manually)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── plans ────────────────────────────────────────────────────
create table public.plans (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  price_usd   numeric(10,2) not null,
  limits_json jsonb not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Seed the 3 plans from the tarifario
insert into public.plans (name, price_usd, limits_json) values
(
  'Básico', 200.00,
  '{"historias":12,"estaticos":4,"videos_cortos":2,"reels":2,"shorts":0,"producciones":1}'
),
(
  'Profesional', 300.00,
  '{"historias":16,"estaticos":8,"videos_cortos":4,"reels":4,"shorts":4,"producciones":2}'
),
(
  'Premium', 400.00,
  '{"historias":16,"estaticos":8,"videos_cortos":8,"reels":4,"shorts":6,"producciones":3}'
);

-- ── clients ──────────────────────────────────────────────────
create table public.clients (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  logo_url         text,
  contact_email    text,
  contact_phone    text,
  ig_handle        text,
  fb_handle        text,
  tiktok_handle    text,
  notes            text,
  current_plan_id  uuid not null references public.plans(id),
  billing_day      int not null check (billing_day between 1 and 31),
  start_date       date not null,
  status           text not null default 'active'
                     check (status in ('active','paused','overdue')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create or replace function public.update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger clients_updated_at
  before update on public.clients
  for each row execute procedure public.update_updated_at();

-- ── billing_cycles ───────────────────────────────────────────
create table public.billing_cycles (
  id                        uuid primary key default gen_random_uuid(),
  client_id                 uuid not null references public.clients(id) on delete cascade,
  plan_id_snapshot          uuid not null references public.plans(id),
  limits_snapshot_json      jsonb not null,
  rollover_from_previous_json jsonb,
  period_start              date not null,
  period_end                date not null,
  status                    text not null default 'current'
                              check (status in ('current','archived','pending_renewal')),
  payment_status            text not null default 'unpaid'
                              check (payment_status in ('paid','unpaid')),
  payment_date              date,
  created_at                timestamptz not null default now()
);

create index billing_cycles_client_id_idx on public.billing_cycles(client_id);
create index billing_cycles_status_idx    on public.billing_cycles(status);
create index billing_cycles_period_end_idx on public.billing_cycles(period_end);

-- ── consumptions ─────────────────────────────────────────────
create table public.consumptions (
  id                    uuid primary key default gen_random_uuid(),
  billing_cycle_id      uuid not null references public.billing_cycles(id) on delete cascade,
  content_type          text not null
                          check (content_type in
                            ('historia','estatico','video_corto','reel','short','produccion')),
  registered_by_user_id uuid not null references public.users(id),
  registered_at         timestamptz not null default now(),
  notes                 text,
  voided                boolean not null default false,
  voided_by_user_id     uuid references public.users(id),
  voided_at             timestamptz,
  over_limit            boolean not null default false
);

create index consumptions_cycle_id_idx on public.consumptions(billing_cycle_id);
create index consumptions_type_idx     on public.consumptions(content_type);

-- ── Row Level Security ────────────────────────────────────────
alter table public.users          enable row level security;
alter table public.plans          enable row level security;
alter table public.clients        enable row level security;
alter table public.billing_cycles enable row level security;
alter table public.consumptions   enable row level security;

-- Helper: is the current user an agency user (any role)?
create or replace function public.is_agency_user()
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.users where id = auth.uid()
  );
$$;

-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  );
$$;

-- users: agency users see all rows; only admins can update roles
create policy "Agency users can view all users"
  on public.users for select
  using (public.is_agency_user());

create policy "Users can update their own profile"
  on public.users for update
  using (auth.uid() = id);

-- plans: anyone authenticated can read; only admin can write
create policy "Agency users can view plans"
  on public.plans for select
  using (public.is_agency_user());

create policy "Admins can manage plans"
  on public.plans for all
  using (public.is_admin());

-- clients
create policy "Agency users can view clients"
  on public.clients for select
  using (public.is_agency_user());

create policy "Agency users can insert clients"
  on public.clients for insert
  with check (public.is_agency_user());

create policy "Agency users can update clients"
  on public.clients for update
  using (public.is_agency_user());

create policy "Only admins can delete clients"
  on public.clients for delete
  using (public.is_admin());

-- billing_cycles
create policy "Agency users can view cycles"
  on public.billing_cycles for select
  using (public.is_agency_user());

create policy "Agency users can insert cycles"
  on public.billing_cycles for insert
  with check (public.is_agency_user());

create policy "Agency users can update cycles"
  on public.billing_cycles for update
  using (public.is_agency_user());

-- consumptions
create policy "Agency users can view consumptions"
  on public.consumptions for select
  using (public.is_agency_user());

create policy "Agency users can register consumptions"
  on public.consumptions for insert
  with check (public.is_agency_user());

create policy "Agency users can void consumptions"
  on public.consumptions for update
  using (public.is_agency_user());
