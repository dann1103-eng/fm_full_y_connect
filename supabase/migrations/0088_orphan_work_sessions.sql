-- 0088_orphan_work_sessions.sql
-- Cleanup de jornadas (work_sessions) y entradas de tiempo (time_entries)
-- "fantasma" — usuarios que olvidan cerrar y el timer queda corriendo
-- entre días, generando duraciones absurdas (ej. 47h online).
--
-- Algoritmo INTELIGENTE: usa la última actividad real del usuario
-- (max time_entries.ended_at en la ventana) para INFERIR cuándo
-- realmente terminó la jornada, en vez de un cap arbitrario. Esto
-- preserva el dato real para coordinadores que sí trabajan 12h+.
--
-- Aplicar manualmente en Supabase Dashboard → SQL Editor.

begin;

-- ── 1) RPC close_orphan_work_sessions ──────────────────────────────
-- Cierra work_sessions con ended_at NULL y started_at viejo.
-- ended_at se infiere desde la última time_entries.ended_at del user
-- en la ventana [started_at, started_at + 24h]. Sin actividad detectable,
-- fallback a started_at + 15 min (asumiendo que la abrió y cerró rápido).
create or replace function public.close_orphan_work_sessions(
  p_user_id uuid default null,
  p_older_than_hours integer default 14
) returns integer
language plpgsql
security definer
set search_path = public
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
    select id, user_id, started_at, breaks_json
    from public.work_sessions
    where ended_at is null
      and started_at < (now() - (p_older_than_hours || ' hours')::interval)
      and (p_user_id is null or user_id = p_user_id)
  loop
    -- Última actividad: max(ended_at) de time_entries dentro de la ventana
    select max(te.ended_at) into v_last_activity
    from public.time_entries te
    where te.user_id = v_session.user_id
      and te.started_at >= v_session.started_at
      and te.started_at <= v_session.started_at + interval '24 hours'
      and te.ended_at is not null;

    -- Inferir ended_at: última actividad + 5 min, o fallback 15 min después de inicio
    v_inferred_end := coalesce(
      v_last_activity + interval '5 minutes',
      v_session.started_at + interval '15 minutes'
    );

    -- Sumar duraciones de pausas cerradas dentro de la ventana
    select coalesce(sum(
      case
        when (b->>'ended_at') is null then 0
        else extract(epoch from ((b->>'ended_at')::timestamptz - (b->>'started_at')::timestamptz))::integer
      end
    ), 0) into v_breaks_seconds
    from jsonb_array_elements(coalesce(v_session.breaks_json, '[]'::jsonb)) b;

    v_total_seconds := greatest(0,
      extract(epoch from (v_inferred_end - v_session.started_at))::integer - v_breaks_seconds
    );

    -- Productive seconds: suma de time_entries dentro de la ventana real
    select coalesce(sum(coalesce(te.duration_seconds, 0))::integer, 0) into v_productive_seconds
    from public.time_entries te
    where te.user_id = v_session.user_id
      and te.started_at >= v_session.started_at
      and te.started_at <= v_inferred_end
      and te.ended_at is not null;

    update public.work_sessions
    set ended_at = v_inferred_end,
        status = 'ended',
        total_seconds = v_total_seconds,
        productive_seconds = v_productive_seconds,
        notes = coalesce(notes, '') ||
                case when coalesce(notes, '') = '' then '' else E'\n' end ||
                '[Auto-cerrada por sistema — jornada huérfana detectada, cierre inferido por última actividad]'
    where id = v_session.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.close_orphan_work_sessions(uuid, integer)
  to authenticated, service_role;

-- ── 2) RPC close_anomalous_work_sessions ───────────────────────────
-- También trunca work_sessions YA CERRADAS pero con total_seconds
-- absurdo (>14h) — caso de Laura: la sesión está closed pero quedó
-- con 47h porque alguien la cerró manualmente sin recalcular. Misma
-- lógica de inferir desde última actividad.
create or replace function public.close_anomalous_work_sessions(
  p_user_id uuid default null,
  p_threshold_hours integer default 14
) returns integer
language plpgsql
security definer
set search_path = public
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
    select id, user_id, started_at, breaks_json
    from public.work_sessions
    where total_seconds > (p_threshold_hours * 3600)
      and (p_user_id is null or user_id = p_user_id)
  loop
    select max(te.ended_at) into v_last_activity
    from public.time_entries te
    where te.user_id = v_session.user_id
      and te.started_at >= v_session.started_at
      and te.started_at <= v_session.started_at + interval '24 hours'
      and te.ended_at is not null;

    v_inferred_end := coalesce(
      v_last_activity + interval '5 minutes',
      v_session.started_at + interval '15 minutes'
    );

    select coalesce(sum(
      case
        when (b->>'ended_at') is null then 0
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
    set ended_at = v_inferred_end,
        total_seconds = v_total_seconds,
        productive_seconds = v_productive_seconds,
        notes = coalesce(notes, '') ||
                case when coalesce(notes, '') = '' then '' else E'\n' end ||
                '[Auto-corregida por sistema — duración anómala (>' || p_threshold_hours || 'h) ajustada a última actividad]'
    where id = v_session.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.close_anomalous_work_sessions(uuid, integer)
  to authenticated, service_role;

-- ── 3) RPC truncate_anomalous_time_entries ─────────────────────────
-- Cap a 1 hora desde started_at para time_entries con duración >14h
-- (sin log histórico de presencia no podemos saber el momento real
-- de fin; 1h es un default conservador, el admin puede editar luego).
create or replace function public.truncate_anomalous_time_entries(
  p_user_id uuid default null,
  p_threshold_hours integer default 14
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
    set ended_at = started_at + interval '1 hour',
        duration_seconds = 3600,
        notes = coalesce(notes, '') ||
                case when coalesce(notes, '') = '' then '' else E'\n' end ||
                '[Auto-cerrada por sistema — duración anómala (>' || p_threshold_hours || 'h) recortada a 1h]'
    where duration_seconds > (p_threshold_hours * 3600)
      and (p_user_id is null or user_id = p_user_id)
    returning 1
  )
  select count(*) into v_count from truncated;

  -- También cubrir time_entries abiertas (ended_at NULL) con started_at viejo
  with closed_open as (
    update public.time_entries
    set ended_at = started_at + interval '1 hour',
        duration_seconds = 3600,
        notes = coalesce(notes, '') ||
                case when coalesce(notes, '') = '' then '' else E'\n' end ||
                '[Auto-cerrada por sistema — entrada abierta huérfana recortada a 1h]'
    where ended_at is null
      and started_at < (now() - (p_threshold_hours || ' hours')::interval)
      and (p_user_id is null or user_id = p_user_id)
    returning 1
  )
  select v_count + count(*) into v_count from closed_open;

  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.truncate_anomalous_time_entries(uuid, integer)
  to authenticated, service_role;

-- ── 4) Cleanup retroactivo one-shot ────────────────────────────────
-- Limpia TODOS los datos históricos anómalos en una sola corrida.
-- Los counts se devuelven via NOTICE para que veas en el SQL Editor
-- cuántas filas se tocaron.
do $$
declare
  v_orphan_ws integer;
  v_anomalous_ws integer;
  v_truncated_te integer;
begin
  v_orphan_ws := public.close_orphan_work_sessions(null, 14);
  v_anomalous_ws := public.close_anomalous_work_sessions(null, 14);
  v_truncated_te := public.truncate_anomalous_time_entries(null, 14);

  raise notice 'Cleanup retroactivo completado:';
  raise notice '  - Jornadas huérfanas cerradas: %', v_orphan_ws;
  raise notice '  - Jornadas con duración anómala corregidas: %', v_anomalous_ws;
  raise notice '  - Entradas de tiempo truncadas: %', v_truncated_te;
end $$;

commit;
