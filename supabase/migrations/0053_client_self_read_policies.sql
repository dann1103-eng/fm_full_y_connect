-- 0053_client_self_read_policies.sql
-- La migración 0052 refactorizó is_agency_user() para excluir 'client',
-- pero no añadió políticas de auto-lectura para clientes en las tablas
-- que solo tenían políticas basadas en is_agency_user().
-- Sin esto, los clientes no pueden leer su propio perfil en public.users
-- y cualquier layout que haga from('users').select().eq('id', uid) devuelve null,
-- causando loops de redirect.

begin;

-- Permitir que cada usuario lea su propia fila en public.users
create policy "Users can read own profile"
  on public.users for select
  using (auth.uid() = id);

commit;
