-- Storage bucket: client-logos (público)
--
-- El bucket debe crearse manualmente en el Supabase Dashboard:
--   Storage → New bucket → Name: "client-logos" → Public: ON
--
-- Una vez creado, ejecutar las siguientes policies desde el SQL Editor:

-- Admins pueden subir logos
create policy "admins_insert_client_logos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'client-logos'
    and exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- Admins pueden actualizar logos existentes
create policy "admins_update_client_logos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'client-logos'
    and exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- Admins pueden eliminar logos
create policy "admins_delete_client_logos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'client-logos'
    and exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- SELECT es público por configuración del bucket (no requiere policy adicional).
