-- Migración 0102: Solicitudes Especiales — sistema bidireccional con notas de seguimiento

-- ── 1. target_user_id en dev_requests ────────────────────────────────────────
alter table public.dev_requests
  add column if not exists target_user_id uuid references auth.users(id) on delete set null;

-- ── 2. Tabla de notas de seguimiento ─────────────────────────────────────────
create table if not exists public.dev_request_notes (
  id         uuid        primary key default gen_random_uuid(),
  request_id uuid        not null references public.dev_requests(id) on delete cascade,
  content    text        not null,
  created_by uuid        references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ── 3. Actualizar RLS en dev_requests ─────────────────────────────────────────
-- Eliminar policies anteriores (unidireccionales)
drop policy if exists "admin_select_dev_requests"          on public.dev_requests;
drop policy if exists "requester_select_own_dev_requests"  on public.dev_requests;
drop policy if exists "requester_insert_dev_requests"      on public.dev_requests;
drop policy if exists "admin_update_dev_requests"          on public.dev_requests;

-- Cualquiera de los dos usuarios involucrados puede ver la solicitud
create policy "involved_select_dev_requests"
  on public.dev_requests for select
  using (
    (created_by = auth.uid() or target_user_id = auth.uid())
    and exists (
      select 1 from public.users where id = auth.uid() and can_request_dev = true
    )
  );

-- Cualquier usuario con can_request_dev puede crear una solicitud
create policy "can_request_dev_insert_dev_requests"
  on public.dev_requests for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.users where id = auth.uid() and can_request_dev = true
    )
  );

-- El destinatario (target_user_id) puede actualizar el estado
create policy "recipient_update_dev_requests"
  on public.dev_requests for update
  using (
    target_user_id = auth.uid()
    and exists (
      select 1 from public.users where id = auth.uid() and can_request_dev = true
    )
  );

-- ── 4. RLS en dev_request_notes ──────────────────────────────────────────────
alter table public.dev_request_notes enable row level security;

-- Los dos usuarios involucrados en la solicitud pueden ver las notas
create policy "involved_select_dev_request_notes"
  on public.dev_request_notes for select
  using (
    exists (
      select 1 from public.dev_requests r
      where r.id = request_id
        and (r.created_by = auth.uid() or r.target_user_id = auth.uid())
    )
    and exists (
      select 1 from public.users where id = auth.uid() and can_request_dev = true
    )
  );

-- Los dos usuarios involucrados pueden agregar notas
create policy "involved_insert_dev_request_notes"
  on public.dev_request_notes for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.dev_requests r
      where r.id = request_id
        and (r.created_by = auth.uid() or r.target_user_id = auth.uid())
    )
    and exists (
      select 1 from public.users where id = auth.uid() and can_request_dev = true
    )
  );
