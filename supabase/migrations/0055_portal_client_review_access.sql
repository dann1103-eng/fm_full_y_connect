-- 0055_portal_client_review_access.sql
-- Acceso del cliente al sistema de revisión (pines + comentarios) cuando
-- el requerimiento está en fase 'revision_cliente'. Aditivo a los policies
-- agency-only de 0044/0049. Al mover el requerimiento fuera de revision_cliente,
-- el cliente pierde acceso automáticamente (pero el data persiste).
--
-- Requisitos previos:
--   * public.is_client_of(uuid) — definida en migración 0052
--   * tablas review_assets / review_versions / review_version_files / review_pins / review_comments

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- review_assets — SELECT
-- ─────────────────────────────────────────────────────────────────────────────
create policy "review_assets_select_client" on public.review_assets
  for select
  using (
    exists (
      select 1 from public.requirements r
      join public.billing_cycles bc on bc.id = r.billing_cycle_id
      where r.id = review_assets.requirement_id
        and r.phase = 'revision_cliente'
        and public.is_client_of(bc.client_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- review_versions — SELECT
-- ─────────────────────────────────────────────────────────────────────────────
create policy "review_versions_select_client" on public.review_versions
  for select
  using (
    exists (
      select 1 from public.review_assets a
      join public.requirements r on r.id = a.requirement_id
      join public.billing_cycles bc on bc.id = r.billing_cycle_id
      where a.id = review_versions.asset_id
        and r.phase = 'revision_cliente'
        and public.is_client_of(bc.client_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- review_version_files — SELECT
-- ─────────────────────────────────────────────────────────────────────────────
create policy "review_version_files_select_client" on public.review_version_files
  for select
  using (
    exists (
      select 1 from public.review_versions v
      join public.review_assets a on a.id = v.asset_id
      join public.requirements r on r.id = a.requirement_id
      join public.billing_cycles bc on bc.id = r.billing_cycle_id
      where v.id = review_version_files.version_id
        and r.phase = 'revision_cliente'
        and public.is_client_of(bc.client_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- review_pins — SELECT + INSERT + UPDATE (comentario raíz del pin propio)
-- ─────────────────────────────────────────────────────────────────────────────
create policy "review_pins_select_client" on public.review_pins
  for select
  using (
    exists (
      select 1 from public.review_versions v
      join public.review_assets a on a.id = v.asset_id
      join public.requirements r on r.id = a.requirement_id
      join public.billing_cycles bc on bc.id = r.billing_cycle_id
      where v.id = review_pins.version_id
        and r.phase = 'revision_cliente'
        and public.is_client_of(bc.client_id)
    )
  );

create policy "review_pins_insert_client" on public.review_pins
  for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.review_versions v
      join public.review_assets a on a.id = v.asset_id
      join public.requirements r on r.id = a.requirement_id
      join public.billing_cycles bc on bc.id = r.billing_cycle_id
      where v.id = review_pins.version_id
        and r.phase = 'revision_cliente'
        and public.is_client_of(bc.client_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- review_comments — SELECT + INSERT
-- ─────────────────────────────────────────────────────────────────────────────
create policy "review_comments_select_client" on public.review_comments
  for select
  using (
    exists (
      select 1 from public.review_pins p
      join public.review_versions v on v.id = p.version_id
      join public.review_assets a on a.id = v.asset_id
      join public.requirements r on r.id = a.requirement_id
      join public.billing_cycles bc on bc.id = r.billing_cycle_id
      where p.id = review_comments.pin_id
        and r.phase = 'revision_cliente'
        and public.is_client_of(bc.client_id)
    )
  );

create policy "review_comments_insert_client" on public.review_comments
  for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.review_pins p
      join public.review_versions v on v.id = p.version_id
      join public.review_assets a on a.id = v.asset_id
      join public.requirements r on r.id = a.requirement_id
      join public.billing_cycles bc on bc.id = r.billing_cycle_id
      where p.id = review_comments.pin_id
        and r.phase = 'revision_cliente'
        and public.is_client_of(bc.client_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage: bucket `review-files` (privado). El cliente necesita leer archivos
-- y thumbnails para ver la última versión mientras deja pines.
-- Path layout: review-files/{requirement_id}/{asset_id}/v{n}.{ext}
--              review-files/{requirement_id}/{asset_id}/v{n}.thumb.jpg
-- Validamos que el primer segmento del path coincida con un requirement en
-- fase revision_cliente cuyo cliente esté vinculado al usuario del portal.
-- ─────────────────────────────────────────────────────────────────────────────
create policy "client_select_review_files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'review-files'
    and exists (
      select 1 from public.requirements r
      join public.billing_cycles bc on bc.id = r.billing_cycle_id
      where r.id::text = split_part(name, '/', 1)
        and r.phase = 'revision_cliente'
        and public.is_client_of(bc.client_id)
    )
  );

commit;
