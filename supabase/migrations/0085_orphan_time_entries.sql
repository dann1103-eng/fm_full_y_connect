-- 0085_orphan_time_entries.sql
-- Defensa contra time_entries huérfanas: filas con ended_at NULL y
-- started_at muy viejo, dejadas por cierres fallidos o crashes.
--
-- Aplicar manualmente en Supabase Dashboard → SQL Editor.

begin;

-- 1) Función helper: cierra todas las huérfanas del usuario que tengan
-- started_at más antiguo que `older_than_hours` horas.
-- ended_at se setea como started_at + 8h (cap razonable de jornada).
create or replace function public.close_orphan_time_entries(
  p_user_id uuid,
  p_older_than_hours integer default 12
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with closed as (
    update public.time_entries
    set ended_at = started_at + interval '8 hours',
        duration_seconds = 28800,
        notes = coalesce(notes, '') ||
                case when coalesce(notes, '') = '' then '' else E'\n' end ||
                '[Auto-cerrada por sistema — entrada huérfana detectada]'
    where user_id = p_user_id
      and ended_at is null
      and started_at < (now() - (p_older_than_hours || ' hours')::interval)
    returning 1
  )
  select count(*) into v_count from closed;
  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.close_orphan_time_entries(uuid, integer)
  to authenticated, service_role;

-- 2) Asegurar time_entries en la publicación realtime (si no estaba)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'time_entries'
    ) then
      execute 'alter publication supabase_realtime add table public.time_entries';
    end if;
  end if;
end $$;

commit;
