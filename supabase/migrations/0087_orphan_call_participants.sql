-- 0087_orphan_call_participants.sql
-- Defensa contra entradas huérfanas en call_participants: filas con
-- left_at NULL cuyo joined_at es muy viejo (típicamente porque el usuario
-- colgó abruptamente desde móvil o se cortó la red, y el webhook de
-- LiveKit no llegó para cerrar la sesión).
--
-- Aplicar manualmente en Supabase Dashboard → SQL Editor.

begin;

-- Cierra entradas de call_participants huérfanas + sesiones sin
-- participantes activos. Devuelve cantidad de filas cerradas.
--
-- Parámetros:
--   p_user_id              — si se pasa, solo limpia las del usuario.
--                            Si es NULL, limpia las de todos.
--   p_older_than_minutes   — umbral de antigüedad (default 240 = 4h).
create or replace function public.close_orphan_call_participants(
  p_user_id uuid default null,
  p_older_than_minutes integer default 240
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- 1) Cerrar las filas huérfanas y guardar los session_id afectados
  update public.call_participants
  set left_at = now()
  where left_at is null
    and joined_at < (now() - (p_older_than_minutes || ' minutes')::interval)
    and (p_user_id is null or user_id = p_user_id);

  get diagnostics v_count = row_count;

  -- 2) Cerrar sesiones que ya no tienen participantes activos
  --    (independiente de qué usuario disparó la limpieza, por consistencia).
  update public.call_sessions cs
  set ended_at = now()
  where cs.ended_at is null
    and not exists (
      select 1 from public.call_participants cp
      where cp.session_id = cs.id and cp.left_at is null
    );

  return v_count;
end;
$$;

grant execute on function public.close_orphan_call_participants(uuid, integer)
  to authenticated, service_role;

commit;
