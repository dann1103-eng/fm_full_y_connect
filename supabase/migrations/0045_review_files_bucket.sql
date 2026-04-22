-- Bucket de archivos para la feature de Revisión de contenido (0044).
-- Privado: accesos por signed URL. Los paths contienen requirement_id + asset_id + versión.
-- Estructura: review-files/{requirement_id}/{asset_id}/v{version_number}.{ext}
--   Thumbnails: review-files/{requirement_id}/{asset_id}/v{version_number}.thumb.jpg
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CREAR BUCKET MANUAL en Supabase Dashboard (Storage → New bucket):
--
--   Nombre:               review-files
--   Público:              NO (privado)
--   File size limit:      200 MB (209715200 bytes)
--   Allowed MIME types:   image/jpeg, image/png, image/webp, image/gif,
--                         video/mp4, video/webm, video/quicktime
--
-- Las políticas RLS se crean con este SQL.
-- ─────────────────────────────────────────────────────────────────────────────

-- SELECT: cualquier agency user puede listar/leer objetos del bucket.
create policy "agency_select_review_files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'review-files'
    and public.is_agency_user()
  );

-- INSERT: cualquier agency user puede subir archivos.
create policy "agency_insert_review_files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'review-files'
    and public.is_agency_user()
  );

-- UPDATE: cualquier agency user puede reemplazar archivos (upsert).
create policy "agency_update_review_files"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'review-files'
    and public.is_agency_user()
  );

-- DELETE: cualquier agency user puede borrar (por ejemplo al eliminar una versión).
create policy "agency_delete_review_files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'review-files'
    and public.is_agency_user()
  );
