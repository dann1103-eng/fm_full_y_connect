-- Admins pueden borrar mensajes en cualquier chat.
-- Para `messages` (DMs y canales) la app hace soft-delete con UPDATE deleted_at.
-- Para `requirement_messages` no hay columna deleted_at -> delete real.

-- messages: admins pueden UPDATE (soft-delete) cualquier mensaje.
create policy "admins_update_messages"
  on public.messages for update to authenticated
  using (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

-- requirement_messages: antes no tenía DELETE policy. Autor o admin.
create policy "authors_or_admins_delete_requirement_messages"
  on public.requirement_messages for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );
