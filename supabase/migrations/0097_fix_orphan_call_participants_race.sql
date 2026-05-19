-- 0097_fix_orphan_call_participants_race.sql
-- Fix de race condition en close_orphan_call_participants.
--
-- BUG ORIGINAL (0087, paso 2): el RPC cerraba CUALQUIER call_session sin
-- participantes activos sin filtro de antigüedad. Esto causaba que cuando
-- un usuario iniciaba una llamada, en la ventana de milisegundos entre el
-- INSERT de call_sessions y el INSERT del primer call_participant, si otra
-- ejecución del RPC se disparaba (touchPresence, cron, otra acción), la
-- sesión recién creada se cerraba inmediatamente y el realtime listener
-- desconectaba a todos los participantes. Síntoma: "a los segundos de
-- empezar la llamada nos saca a todos".
--
-- FIX: añadir gracia mínima de 5 minutos sobre call_sessions.started_at.
-- Una sesión recién creada nunca se cierra automáticamente, incluso si
-- aún no tiene participants insertados. Después de 5 min sin participantes
-- activos, el cleanup procede como antes.

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
  -- 1) Cerrar participants huérfanos (joined_at > N min sin left_at)
  update public.call_participants
  set left_at = now()
  where left_at is null
    and joined_at < (now() - (p_older_than_minutes || ' minutes')::interval)
    and (p_user_id is null or user_id = p_user_id);

  get diagnostics v_count = row_count;

  -- 2) Cerrar sesiones sin participants activos, PERO solo si la sesión ya
  --    tiene al menos 5 minutos de antigüedad. Esto previene el race de
  --    cerrar sesiones recién creadas que aún no han recibido su primer
  --    call_participant.
  update public.call_sessions cs
  set ended_at = now()
  where cs.ended_at is null
    and cs.started_at < (now() - interval '5 minutes')
    and not exists (
      select 1 from public.call_participants cp
      where cp.session_id = cs.id and cp.left_at is null
    );

  return v_count;
end;
$$;
