-- 0052_client_portal_foundations.sql
-- Fundamentos del Portal del Cliente:
-- 1) rol 'client' + refactor is_agency_user
-- 2) tabla client_users (user ↔ cliente N:N)
-- 3) helper is_client_of
-- 4) flag visible_to_client en requirement_messages
-- 5) tabla renewal_requests
-- 6) policies complementarias (staff OR client_of) en tablas expuestas al portal
--
-- Nota de schema: public.requirements NO tiene columna client_id. El vínculo al
-- cliente pasa por billing_cycle_id → billing_cycles.client_id. Las policies del
-- cliente sobre requirements y requirement_messages hacen join a billing_cycles.

begin;

-- 1) Ampliar CHECK de users.role
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('admin','supervisor','operator','client'));

-- 1b) Refactor is_agency_user: excluir role='client'
create or replace function public.is_agency_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and role in ('admin','supervisor','operator')
  );
$$;

-- 2) client_users
create table public.client_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','viewer')),
  created_at timestamptz not null default now(),
  unique (user_id, client_id)
);
create index client_users_user_idx on public.client_users(user_id);
create index client_users_client_idx on public.client_users(client_id);
alter table public.client_users enable row level security;

-- RLS client_users: staff lee todo; cliente solo sus propias filas
create policy "Agency users can view client_users"
  on public.client_users for select
  using (public.is_agency_user());
create policy "Clients can view their own client_users"
  on public.client_users for select
  using (user_id = auth.uid());
create policy "Admins manage client_users"
  on public.client_users for all
  using (public.is_admin())
  with check (public.is_admin());

-- 3) Helper is_client_of(client_id)
create or replace function public.is_client_of(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.client_users
    where user_id = auth.uid()
      and client_id = target_client_id
  );
$$;

-- 4) visible_to_client en requirement_messages
alter table public.requirement_messages
  add column if not exists visible_to_client boolean not null default false;
create index if not exists requirement_messages_visible_client_idx
  on public.requirement_messages(requirement_id)
  where visible_to_client = true;

-- 5) renewal_requests
create table public.renewal_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  requested_by uuid not null references public.users(id),
  from_cycle_id uuid references public.billing_cycles(id),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','completed')),
  rollover_items_json jsonb not null default '[]'::jsonb,
  addons_json jsonb not null default '{}'::jsonb,
  admin_notes text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.users(id)
);
create index renewal_requests_client_idx on public.renewal_requests(client_id);
create index renewal_requests_status_idx on public.renewal_requests(status);
alter table public.renewal_requests enable row level security;

create policy "Staff or owner-client can view renewal_requests"
  on public.renewal_requests for select
  using (public.is_agency_user() or public.is_client_of(client_id));
create policy "Owner-client can create renewal_requests"
  on public.renewal_requests for insert
  with check (public.is_client_of(client_id) and requested_by = auth.uid());
create policy "Admin can decide renewal_requests"
  on public.renewal_requests for update
  using (public.is_admin())
  with check (public.is_admin());

-- 6) Extender policies existentes para que clients vean lo suyo.
--    Patrón: añadir policies PERMISSIVE adicionales (no alterar las de staff).

-- clients
create policy "Client can view own client row"
  on public.clients for select
  using (public.is_client_of(id));

-- billing_cycles
create policy "Client can view own cycles"
  on public.billing_cycles for select
  using (public.is_client_of(client_id));

-- requirements (no tiene client_id directo; join via billing_cycles)
create policy "Client can view own requirements"
  on public.requirements for select
  using (
    exists (
      select 1 from public.billing_cycles bc
      where bc.id = requirements.billing_cycle_id
        and public.is_client_of(bc.client_id)
    )
  );

-- requirement_messages: cliente solo ve visible_to_client=true
-- (el join pasa por requirements → billing_cycles para llegar al client_id)
create policy "Client can view visible messages"
  on public.requirement_messages for select
  using (
    visible_to_client = true
    and exists (
      select 1
      from public.requirements r
      join public.billing_cycles bc on bc.id = r.billing_cycle_id
      where r.id = requirement_messages.requirement_id
        and public.is_client_of(bc.client_id)
    )
  );
create policy "Client can insert visible messages"
  on public.requirement_messages for insert
  with check (
    visible_to_client = true
    and user_id = auth.uid()
    and exists (
      select 1
      from public.requirements r
      join public.billing_cycles bc on bc.id = r.billing_cycle_id
      where r.id = requirement_id
        and public.is_client_of(bc.client_id)
    )
  );

-- invoices / quotes (schema de 0048)
create policy "Client can view own invoices"
  on public.invoices for select
  using (public.is_client_of(client_id));
create policy "Client can view own quotes"
  on public.quotes for select
  using (public.is_client_of(client_id));

-- Nota: calendar-related (time_entries) se cubrirá en Fase 3 cuando
-- se defina exactamente qué debe ver el cliente. Por ahora sus policies
-- siguen siendo solo is_agency_user().

commit;
