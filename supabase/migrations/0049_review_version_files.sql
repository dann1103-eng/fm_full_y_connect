-- Feature: versiones multi-archivo en el sistema de revisión.
-- Hoy cada review_version tiene UN archivo (storage_path). Ahora una versión
-- puede componerse de N archivos (ej. carrusel de 5 imágenes). Los pines pasan
-- a referenciar un archivo específico dentro de la versión.
--
-- Compatibilidad:
--   * review_versions.storage_path / thumbnail_path / mime_type se conservan
--     por compat (backfill copia a review_version_files el primer archivo).
--     El frontend deja de usarlos.
--   * review_pins.file_id es NULLABLE; pines legacy quedan ligados al único
--     file_order=0 de su versión (vía backfill).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. review_version_files
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.review_version_files (
  id             uuid primary key default gen_random_uuid(),
  version_id     uuid not null references public.review_versions(id) on delete cascade,
  file_order     int  not null,
  storage_path   text not null,
  thumbnail_path text,
  mime_type      text not null,
  byte_size      bigint not null,
  duration_ms    int,
  created_at     timestamptz not null default now(),
  unique (version_id, file_order)
);

create index if not exists review_version_files_version_idx
  on public.review_version_files(version_id, file_order);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. review_pins.file_id
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.review_pins
  add column if not exists file_id uuid references public.review_version_files(id) on delete cascade;

create index if not exists review_pins_file_idx on public.review_pins(file_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backfill
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.review_version_files
  (version_id, file_order, storage_path, thumbnail_path, mime_type, byte_size, duration_ms)
select v.id, 0, v.storage_path, v.thumbnail_path, v.mime_type, coalesce(v.byte_size, 0), v.duration_ms
  from public.review_versions v
  left join public.review_version_files f
    on f.version_id = v.id and f.file_order = 0
 where v.storage_path is not null
   and f.id is null;

update public.review_pins p
   set file_id = f.id
  from public.review_version_files f
 where f.version_id = p.version_id
   and f.file_order = 0
   and p.file_id is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS — mismo patrón is_agency_user() que el resto de tablas de review
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.review_version_files enable row level security;

create policy "Agency users view review_version_files"
  on public.review_version_files for select
  using (public.is_agency_user());

create policy "Agency users insert review_version_files"
  on public.review_version_files for insert
  with check (public.is_agency_user());

create policy "Agency users update review_version_files"
  on public.review_version_files for update
  using (public.is_agency_user());

create policy "Agency users delete review_version_files"
  on public.review_version_files for delete
  using (public.is_agency_user());

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Realtime
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.review_version_files';
  end if;
exception when duplicate_object then
  null;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. GRANTs
-- ─────────────────────────────────────────────────────────────────────────────
grant all on public.review_version_files to anon, authenticated, service_role;

notify pgrst, 'reload schema';
