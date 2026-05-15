-- 0091_session_heartbeat.sql
-- Añade columna last_alive_at a work_sessions para detectar jornadas huérfanas
-- por inactividad real (no por tiempo desde inicio).
--
-- Problema raíz: close_orphan_work_sessions usaba started_at < now-14h como
-- threshold. Si el usuario abre jornada a las 8AM y cierra el browser a las
-- 2PM, la sesión no se detecta hasta las 10PM (14h después del inicio).
--
-- Solución: touchPresence() actualiza last_alive_at cada 20 min. El RPC ahora
-- usa last_alive_at < now-4h — detecta inactividad real desde el último ping.
--
-- Aplicar manualmente en Supabase Dashboard → SQL Editor.

begin;

-- ── 1) Columna last_alive_at ────────────────────────────────────────────────
alter table public.work_sessions
  add column if not exists last_alive_at timestamptz;

-- Backfill conservador: sesiones cerradas → ended_at; abiertas → started_at
update public.work_sessions
set last_alive_at = coalesce(ended_at, started_at)
where last_alive_at is null;

-- ── 2) RPC close_orphan_work_sessions (reemplaza la de 0088) ───────────────
-- Ahora usa last_alive_at < now - 4h (heartbeat-based) en lugar de
-- started_at < now - 14h. También cierra time_entries abiertas en la ventana
-- antes de cerrar la sesión.
create or replace function public.close_orphan_work_sessions(
  p_user_id uuid default null,
  p_older_than_hours integer default 14   -- solo para rows sin last_alive_at (legacy)
) returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer := 0;
  v_session record;
  v_last_activity timestamptz;
  v_inferred_end timestamptz;
  v_breaks_seconds integer;
  v_total_seconds integer;
  v_productive_seconds integer;
begin
  for v_session in
    select id, user_id, started_at, last_alive_at, breaks_json
    from public.work_sessions
    where ended_at is null
      and (p_user_id is null or user_id = p_user_id)
      and (
        -- Sesiones con heartbeat: inactivas hace >4h
        (last_alive_at is not null and last_alive_at < now() - interval '4 hours')
        -- Sesiones sin heartbeat (legacy, pre-0091): threshold original
        or (last_alive_at is null and started_at < (now() - (p_older_than_hours || ' hours')::interval))
      )
  loop
    -- Cerrar time_entries abiertas del usuario en la ventana de la sesión
    update public.time_entries
    set ended_at = coalesce(v_session.last_alive_at, v_session.started_at + interval '15 minutes'),
        duration_seconds = greatest(0,
          extract(epoch from (
            coalesce(v_session.last_alive_at, v_session.started_at + interval '15 minutes') - started_at
          ))::integer
        ),
        notes = coalesce(notes, '') ||
                case when coalesce(notes, '') = '' then '' else E'\n' end ||
                '[Auto-cerrada por sistema — entry huérfana al cierre de jornada]'
    where user_id = v_session.user_id
      and ended_at is null
      and started_at >= v_session.started_at
      and started_at <= v_session.started_at + interval '24 hours';

    -- Inferir ended_at de la sesión: MAX(last_alive_at, última time_entry) + 5 min
    select max(te.ended_at) into v_last_activity
    from public.time_entries te
    where te.user_id = v_session.user_id
      and te.started_at >= v_session.started_at
      and te.started_at <= v_session.started_at + interval '24 hours'
      and te.ended_at is not null;

    v_inferred_end := coalesce(
      greatest(v_last_activity, v_session.last_alive_at) + interval '5 minutes',
      v_last_activity + interval '5 minutes',
      v_session.last_alive_at + interval '5 minutes',
      v_session.started_at + interval '15 minutes'
    );

    -- Pausas cerradas
    select coalesce(sum(
      case when (b->>'ended_at') is null then 0
        else extract(epoch from ((b->>'ended_at')::timestamptz - (b->>'started_at')::timestamptz))::integer
      end
    ), 0) into v_breaks_seconds
    from jsonb_array_elements(coalesce(v_session.breaks_json, '[]'::jsonb)) b;

    v_total_seconds := greatest(0,
      extract(epoch from (v_inferred_end - v_session.started_at))::integer - v_breaks_seconds
    );

    select coalesce(sum(coalesce(te.duration_seconds, 0))::integer, 0) into v_productive_seconds
    from public.time_entries te
    where te.user_id = v_session.user_id
      and te.started_at >= v_session.started_at
      and te.started_at <= v_inferred_end
      and te.ended_at is not null;

    update public.work_sessions
    set ended_at           = v_inferred_end,
        status             = 'ended',
        total_seconds      = v_total_seconds,
        productive_seconds = v_productive_seconds,
        notes = coalesce(notes, '') ||
                case when coalesce(notes, '') = '' then '' else E'\n' end ||
                '[Auto-cerrada por sistema — jornada huérfana, cierre inferido por última actividad]'
    where id = v_session.id;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.close_orphan_work_sessions(uuid, integer)
  to authenticated, service_role;

-- ── 3) Cleanup retroactivo one-shot ────────────────────────────────────────
-- Cierra jornadas y time_entries huérfanas históricas con el threshold
-- original de 14h (conservador — rows recientes ya tienen last_alive_at).
do $$
declare
  v_ws integer;
  v_te integer;
begin
  v_ws := public.close_orphan_work_sessions(null, 14);
  v_te := public.truncate_anomalous_time_entries(null, 14);
  raise notice 'Cleanup retroactivo 0091: % jornadas cerradas, % time_entries truncadas', v_ws, v_te;
end $$;

commit;
