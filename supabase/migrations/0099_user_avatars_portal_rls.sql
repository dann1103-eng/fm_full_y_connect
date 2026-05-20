-- 0099 — Fix avatar upload para usuarios portal
--
-- Las políticas del bucket user-avatars fueron creadas manualmente en 0018 y
-- probablemente usan is_agency_user(), bloqueando a clientes del portal.
-- Este script limpia esas políticas y las recrea para cualquier usuario
-- autenticado (staff + portal clients), con la condición de que solo puedan
-- gestionar archivos dentro de su propia carpeta ({uid}/*).

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '')       ilike '%user-avatars%'
        or coalesce(with_check, '') ilike '%user-avatars%'
      )
  loop
    execute format('drop policy if exists %I on storage.objects', pol.policyname);
  end loop;
end $$;

-- Cualquier usuario autenticado puede subir/actualizar su propia carpeta
create policy "user_avatars_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'user-avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "user_avatars_update"
  on storage.objects for update
  using (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "user_avatars_delete"
  on storage.objects for delete
  using (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Lectura pública (el bucket es público)
create policy "user_avatars_select"
  on storage.objects for select
  using (bucket_id = 'user-avatars');
