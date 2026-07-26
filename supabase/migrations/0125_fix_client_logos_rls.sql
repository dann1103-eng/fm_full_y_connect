-- 0125_fix_client_logos_rls.sql
-- Fix: "new row violates row-level security policy" al subir logos de clientes.
--
-- CAUSA: el bucket client-logos se sube vía browser client (sujeto a RLS). La
-- única policy de INSERT (migración 0007) exige role='admin'. Pero LogoUploader
-- se usa desde DOS lugares:
--   - staff:  /clients/[id]/edit        (admin/supervisor)
--   - portal: ClientEmpresaForm         (el PROPIO cliente, role='client')
-- => cualquier no-admin (supervisor o el cliente del portal) queda bloqueado.
-- Además, al migrar a esta DB las policies MANUALES de 0007 pueden no haberse
-- aplicado nunca (storage.objects tiene RLS deny-by-default) → bloquea a todos.
--
-- FIX: recrear las policies de client-logos permitiendo:
--   - staff interno (admin/supervisor/operator): cualquier carpeta
--   - el propio cliente (is_client_of): SOLO su carpeta {clientId}/
-- Idempotente: limpia cualquier policy previa de client-logos y las recrea,
-- así funciona tanto si faltaban como si estaban mal (admin-only).
--
-- NOTA: los avatares de usuarios usan el bucket user-avatars (policies en 0099).
--       Si también fallan al re-subir, aplicar 0099 en esta MISMA DB (misma causa).

-- Asegura que el bucket sea público (para getPublicUrl). No-op si ya lo es.
update storage.buckets set public = true where id = 'client-logos';

-- Limpieza idempotente de cualquier policy previa que refiera a client-logos.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual, '')       ilike '%client-logos%'
        or coalesce(with_check, '') ilike '%client-logos%')
  loop
    execute format('drop policy if exists %I on storage.objects', pol.policyname);
  end loop;
end $$;

-- INSERT: staff interno (cualquier carpeta) o el propio cliente en su carpeta {clientId}/
create policy "client_logos_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'client-logos'
    and (
      exists (select 1 from public.users
              where id = auth.uid() and role in ('admin','supervisor','operator'))
      or public.is_client_of(((storage.foldername(name))[1])::uuid)
    )
  );

-- UPDATE (reemplazo / upsert)
create policy "client_logos_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'client-logos'
    and (
      exists (select 1 from public.users
              where id = auth.uid() and role in ('admin','supervisor','operator'))
      or public.is_client_of(((storage.foldername(name))[1])::uuid)
    )
  )
  with check (
    bucket_id = 'client-logos'
    and (
      exists (select 1 from public.users
              where id = auth.uid() and role in ('admin','supervisor','operator'))
      or public.is_client_of(((storage.foldername(name))[1])::uuid)
    )
  );

-- DELETE
create policy "client_logos_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'client-logos'
    and (
      exists (select 1 from public.users
              where id = auth.uid() and role in ('admin','supervisor','operator'))
      or public.is_client_of(((storage.foldername(name))[1])::uuid)
    )
  );

-- Lectura pública (el bucket es público).
create policy "client_logos_select"
  on storage.objects for select
  using (bucket_id = 'client-logos');
