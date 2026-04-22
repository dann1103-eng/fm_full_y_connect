-- Admins pueden borrar mensajes en cualquier chat.
-- Para `messages` (DMs y canales) la app hace soft-delete con UPDATE deleted_at.
-- Para `requirement_messages` no hay columna deleted_at -> delete real.

-- messages: consolidamos Authors + admins en UNA sola policy de UPDATE
-- (elimina cualquier edge-case con OR entre múltiples permissive policies).
drop policy if exists "Authors can edit their messages" on public.messages;
drop policy if exists "admins_update_messages"          on public.messages;
drop policy if exists "authors_or_admins_update_messages" on public.messages;

create policy "authors_or_admins_update_messages"
  on public.messages for update to authenticated
  using     ( user_id = auth.uid() or public.is_admin() )
  with check( user_id = auth.uid() or public.is_admin() );

-- Lo mismo para DELETE (hard-delete) por si en el futuro se usa.
drop policy if exists "Authors can delete their messages" on public.messages;
drop policy if exists "authors_or_admins_delete_messages" on public.messages;

create policy "authors_or_admins_delete_messages"
  on public.messages for delete to authenticated
  using ( user_id = auth.uid() or public.is_admin() );

-- requirement_messages: antes no tenía DELETE policy. Autor o admin.
drop policy if exists "authors_or_admins_delete_requirement_messages" on public.requirement_messages;
create policy "authors_or_admins_delete_requirement_messages"
  on public.requirement_messages for delete to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
  );

-- Pedir a PostgREST que recargue su cache de schema.
notify pgrst, 'reload schema';
