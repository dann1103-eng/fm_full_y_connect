-- Policies faltantes para el bucket `agency-assets`.
-- La migración 0030_app_settings.sql documentó estas policies como comentarios
-- pero nunca se registraron como SQL ejecutable — causa del error
-- "new row violates row-level security policy" al subir el logo de agencia.
--
-- Requisito previo: el bucket `agency-assets` debe existir (Storage → New bucket
-- → Name: "agency-assets" → Public: ON). SELECT es público por configuración del
-- bucket, por eso no se crea policy de SELECT aquí.

create policy "admins_insert_agency_assets"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'agency-assets'
    and exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "admins_update_agency_assets"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'agency-assets'
    and exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

create policy "admins_delete_agency_assets"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'agency-assets'
    and exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );
