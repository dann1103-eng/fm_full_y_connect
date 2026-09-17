-- 0129_content_matrices.sql
-- Creador de matrices · Bloque 1. Matriz de contenido mensual por cliente y período
-- objetivo (ciclo de facturación) con sus piezas planificadas.
-- Spec: docs/superpowers/specs/2026-09-16-creador-de-matrices-bloque-1-design.md
--
-- Campos reservados para bloques posteriores (no se usan aún):
--   content_matrices.lead_days, content_matrix_items.status ('converted'|'blocked'),
--   content_matrix_items.requirement_id, índice content_matrix_items_planned_idx.

begin;

-- ── 1. content_matrices ──────────────────────────────────────────────────────
create table if not exists public.content_matrices (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients(id) on delete cascade,
  period_start          date not null,
  period_end            date not null,
  billing_cycle_id      uuid references public.billing_cycles(id) on delete set null,
  title                 text not null default '',
  status                text not null default 'draft'
                        check (status in ('draft','approved','closed')),
  topics_json           jsonb not null default '[]'::jsonb,
  notes                 text,
  lead_days             smallint not null default 7 check (lead_days between 0 and 30),
  matrix_requirement_id uuid references public.requirements(id) on delete set null,
  created_by            uuid not null references public.users(id),
  approved_by           uuid references public.users(id),
  approved_at           timestamptz,
  closed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint content_matrices_period_chk check (period_end > period_start),
  constraint content_matrices_client_period_uq unique (client_id, period_start)
);

create index if not exists content_matrices_client_idx
  on public.content_matrices (client_id, period_start desc);
create index if not exists content_matrices_status_idx
  on public.content_matrices (status, period_start desc);

-- ── 2. content_matrix_items ──────────────────────────────────────────────────
create table if not exists public.content_matrix_items (
  id               uuid primary key default gen_random_uuid(),
  matrix_id        uuid not null references public.content_matrices(id) on delete cascade,
  content_type     text not null
                   check (content_type in ('historia','estatico','video_corto','reel','short')),
  title            text not null default '',
  topic            text,
  objective        text check (objective in ('venta','alcance','educacion','comunidad','otro')),
  copy             text,
  script           text,
  visual_style     text,
  hashtags         text,
  cta              text,
  deadline         date not null,
  needs_production boolean not null default false,
  status           text not null default 'planned'
                   check (status in ('planned','converted','blocked')),
  requirement_id   uuid references public.requirements(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists content_matrix_items_matrix_idx
  on public.content_matrix_items (matrix_id, deadline, created_at);
create index if not exists content_matrix_items_planned_idx
  on public.content_matrix_items (deadline)
  where status = 'planned';

-- ── 3. updated_at (reusa public.update_updated_at() de 0001_init.sql) ────────
drop trigger if exists content_matrices_updated_at on public.content_matrices;
create trigger content_matrices_updated_at
  before update on public.content_matrices
  for each row execute procedure public.update_updated_at();

drop trigger if exists content_matrix_items_updated_at on public.content_matrix_items;
create trigger content_matrix_items_updated_at
  before update on public.content_matrix_items
  for each row execute procedure public.update_updated_at();

-- ── 4. RLS: solo admin y supervisor (patrón 0117_assigned_tasks) ─────────────
alter table public.content_matrices      enable row level security;
alter table public.content_matrix_items  enable row level security;

drop policy if exists "content_matrices_manage" on public.content_matrices;
create policy "content_matrices_manage"
  on public.content_matrices for all
  using (
    exists (select 1 from public.users where id = auth.uid() and role in ('admin','supervisor'))
  )
  with check (
    exists (select 1 from public.users where id = auth.uid() and role in ('admin','supervisor'))
  );

drop policy if exists "content_matrix_items_manage" on public.content_matrix_items;
create policy "content_matrix_items_manage"
  on public.content_matrix_items for all
  using (
    exists (select 1 from public.users where id = auth.uid() and role in ('admin','supervisor'))
  )
  with check (
    exists (select 1 from public.users where id = auth.uid() and role in ('admin','supervisor'))
  );

commit;
