-- 0089_future_time_entries.sql
-- Fix para time_entries con ended_at en el futuro: cuando admin agrega
-- una entrada con endedAt > now() (ej. "Reunión Interna 08:00 - 13:00"
-- registrada a las 11am), duration_seconds se infla con tiempo que aún
-- no transcurrió. Resultado: Tiempo productivo > Tiempo online (imposible).
--
-- Aplicar manualmente en Supabase Dashboard → SQL Editor.

begin;

-- ── RPC truncate_future_time_entries ───────────────────────────────
-- Para cada time_entry con ended_at > now(): trunca ended_at a now()
-- y recalcula duration_seconds.
create or replace function public.truncate_future_time_entries(
  p_user_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with truncated as (
    update public.time_entries
    set ended_at = now(),
        duration_seconds = greatest(0,
          extract(epoch from (now() - started_at))::integer
        ),
        notes = coalesce(notes, '') ||
                case when coalesce(notes, '') = '' then '' else E'\n' end ||
                '[Auto-corregida por sistema — ended_at estaba en el futuro, recortado a momento de detección]'
    where ended_at > (now() + interval '1 minute')
      and (p_user_id is null or user_id = p_user_id)
    returning 1
  )
  select count(*) into v_count from truncated;
  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.truncate_future_time_entries(uuid)
  to authenticated, service_role;

-- ── Cleanup retroactivo one-shot ───────────────────────────────────
do $$
declare
  v_count integer;
begin
  v_count := public.truncate_future_time_entries(null);
  raise notice 'Cleanup one-shot completado: % entradas con ended_at futuro corregidas', v_count;
end $$;

commit;
