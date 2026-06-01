-- Migración 0101: Solicitudes al Desarrollador
-- Feature interna: un usuario específico puede enviar solicitudes de cambio al dev (admin).

-- ── 1. Columna en users ───────────────────────────────────────────────────────
alter table public.users
  add column if not exists can_request_dev boolean not null default false;

-- ── 2. Tabla dev_requests ─────────────────────────────────────────────────────
create table if not exists public.dev_requests (
  id                  uuid        primary key default gen_random_uuid(),
  title               text        not null,
  description         text        not null,
  compensation_method text        not null,
  created_by          uuid        references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  status              text        not null default 'pending'
    check (status in ('pending', 'in_progress', 'done', 'rejected'))
);

-- ── 3. RLS ────────────────────────────────────────────────────────────────────
alter table public.dev_requests enable row level security;

-- Admin ve todas las solicitudes
create policy "admin_select_dev_requests"
  on public.dev_requests for select
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- El requester ve solo las suyas
create policy "requester_select_own_dev_requests"
  on public.dev_requests for select
  using (
    created_by = auth.uid()
    and exists (
      select 1 from public.users
      where id = auth.uid() and can_request_dev = true
    )
  );

-- Solo el requester puede insertar
create policy "requester_insert_dev_requests"
  on public.dev_requests for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.users
      where id = auth.uid() and can_request_dev = true
    )
  );

-- Solo admin puede actualizar el estado
create policy "admin_update_dev_requests"
  on public.dev_requests for update
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );
