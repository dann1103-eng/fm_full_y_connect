-- Feature: Revisión de contenido (estilo Frame.io / Skool) dentro de RequirementModal.
-- 4 tablas: review_assets (archivo lógico), review_versions (cada versión subida),
-- review_pins (punto de revisión posicional — y temporal en videos) y review_comments
-- (thread anclado al pin, con respuestas anidadas un nivel).
--
-- Decisiones del diseño:
--   * Cada VERSIÓN es independiente: sus pines no "viajan" a la siguiente versión.
--   * Pin numbering secuencial por versión (review_pins.pin_number, UNIQUE por version_id).
--   * Threads: review_comments.parent_id NULL = comentario raíz; no-NULL = respuesta.
--   * Permisos: todos los agency users pueden crear/resolver/reabrir/eliminar.
--   * Realtime habilitado en las 4 tablas para colaboración live.
--
-- Requisitos: bucket `review-files` debe existir en Storage (ver 0045).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. review_assets
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.review_assets (
  id              uuid primary key default gen_random_uuid(),
  requirement_id  uuid not null references public.requirements(id) on delete cascade,
  name            text not null,
  kind            text not null check (kind in ('image','video')),
  created_by      uuid references public.users(id),
  created_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create index if not exists review_assets_requirement_idx on public.review_assets(requirement_id);
create index if not exists review_assets_archived_idx    on public.review_assets(archived_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. review_versions
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.review_versions (
  id              uuid primary key default gen_random_uuid(),
  asset_id        uuid not null references public.review_assets(id) on delete cascade,
  version_number  int  not null,
  storage_path    text not null,
  mime_type       text not null,
  byte_size       bigint not null,
  thumbnail_path  text,
  duration_ms     int,
  uploaded_by     uuid references public.users(id),
  uploaded_at     timestamptz not null default now(),
  unique (asset_id, version_number)
);

create index if not exists review_versions_asset_idx on public.review_versions(asset_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. review_pins
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.review_pins (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references public.review_versions(id) on delete cascade,
  pin_number    int  not null,
  pos_x_pct     numeric(6,3) not null check (pos_x_pct between 0 and 100),
  pos_y_pct     numeric(6,3) not null check (pos_y_pct between 0 and 100),
  timestamp_ms  int check (timestamp_ms is null or timestamp_ms >= 0),
  status        text not null default 'active' check (status in ('active','resolved')),
  created_by    uuid references public.users(id),
  created_at    timestamptz not null default now(),
  resolved_by   uuid references public.users(id),
  resolved_at   timestamptz,
  unique (version_id, pin_number)
);

create index if not exists review_pins_version_idx on public.review_pins(version_id);
create index if not exists review_pins_status_idx  on public.review_pins(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. review_comments
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.review_comments (
  id          uuid primary key default gen_random_uuid(),
  pin_id      uuid not null references public.review_pins(id) on delete cascade,
  parent_id   uuid references public.review_comments(id) on delete cascade,
  user_id     uuid references public.users(id),
  body        text not null check (length(body) > 0),
  edited_at   timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists review_comments_pin_idx    on public.review_comments(pin_id);
create index if not exists review_comments_parent_idx on public.review_comments(parent_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — patrón is_agency_user() (mismo que el resto del CRM)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.review_assets   enable row level security;
alter table public.review_versions enable row level security;
alter table public.review_pins     enable row level security;
alter table public.review_comments enable row level security;

-- review_assets
create policy "Agency users view review_assets"
  on public.review_assets for select
  using (public.is_agency_user());

create policy "Agency users insert review_assets"
  on public.review_assets for insert
  with check (public.is_agency_user());

create policy "Agency users update review_assets"
  on public.review_assets for update
  using (public.is_agency_user());

create policy "Agency users delete review_assets"
  on public.review_assets for delete
  using (public.is_agency_user());

-- review_versions
create policy "Agency users view review_versions"
  on public.review_versions for select
  using (public.is_agency_user());

create policy "Agency users insert review_versions"
  on public.review_versions for insert
  with check (public.is_agency_user());

create policy "Agency users update review_versions"
  on public.review_versions for update
  using (public.is_agency_user());

create policy "Agency users delete review_versions"
  on public.review_versions for delete
  using (public.is_agency_user());

-- review_pins
create policy "Agency users view review_pins"
  on public.review_pins for select
  using (public.is_agency_user());

create policy "Agency users insert review_pins"
  on public.review_pins for insert
  with check (public.is_agency_user());

create policy "Agency users update review_pins"
  on public.review_pins for update
  using (public.is_agency_user());

create policy "Agency users delete review_pins"
  on public.review_pins for delete
  using (public.is_agency_user());

-- review_comments
create policy "Agency users view review_comments"
  on public.review_comments for select
  using (public.is_agency_user());

create policy "Agency users insert review_comments"
  on public.review_comments for insert
  with check (public.is_agency_user());

create policy "Agency users update review_comments"
  on public.review_comments for update
  using (public.is_agency_user() and (user_id = auth.uid() or public.is_admin()));

create policy "Agency users delete review_comments"
  on public.review_comments for delete
  using (public.is_agency_user() and (user_id = auth.uid() or public.is_admin()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime: habilitar en la publicación supabase_realtime
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.review_assets';
    execute 'alter publication supabase_realtime add table public.review_versions';
    execute 'alter publication supabase_realtime add table public.review_pins';
    execute 'alter publication supabase_realtime add table public.review_comments';
  end if;
exception when duplicate_object then
  -- tablas ya incluidas en la publicación — ignorar
  null;
end$$;
