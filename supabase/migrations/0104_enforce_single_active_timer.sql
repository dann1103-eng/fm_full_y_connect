-- Migración 0104: garantizar UN solo timer activo por usuario (anti race-condition)
--
-- Contexto: un usuario reportó tener 2 timers activos a la vez. La causa es un
-- check-then-act race: con dos pestañas abiertas, ambas leen "no hay timer
-- activo" y ambas insertan. Lo único que debería impedirlo es el índice único
-- parcial `time_entries_one_active_per_user` (migración 0014). Si ese índice
-- nunca se creó en producción (p.ej. la migración 0014 falló al crearlo porque
-- ya existían duplicados en ese momento — CREATE UNIQUE INDEX da error con datos
-- duplicados, no los ignora), entonces no hay nada que bloquee el doble INSERT.
--
-- Esta migración es idempotente y auto-reparadora:
--   1. Cierra los duplicados activos existentes (deja solo el más reciente por
--      usuario), con duración 0 para no inflar el tiempo productivo.
--   2. (Re)crea el índice único parcial — ahora seguro porque ya no hay dups.

-- ── 1. Deduplicar entradas activas ───────────────────────────────────────────
-- Por cada usuario con >1 entrada activa (ended_at IS NULL), conservar SOLO la de
-- started_at más reciente (la que el usuario está usando) y cerrar las demás.
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id
      order by started_at desc, id desc
    ) as rn
  from public.time_entries
  where ended_at is null
)
update public.time_entries te
set ended_at = te.started_at,   -- duración 0: no suma tiempo, solo libera el slot
    duration_seconds = 0
from ranked r
where te.id = r.id
  and r.rn > 1;

-- ── 2. Garantizar el índice único parcial ────────────────────────────────────
-- IF NOT EXISTS: si ya existe (0014 sí se aplicó), es no-op. Si falta, lo crea.
create unique index if not exists time_entries_one_active_per_user
  on public.time_entries (user_id)
  where ended_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- DIAGNÓSTICO (opcional — correr en el SQL Editor para confirmar el estado):
--
--   -- ¿Existe el índice?  (debe devolver 1 fila)
--   select indexname from pg_indexes
--   where tablename = 'time_entries' and indexname = 'time_entries_one_active_per_user';
--
--   -- ¿Hay usuarios con >1 timer activo AHORA? (debe devolver 0 filas tras la migración)
--   select user_id, count(*) from public.time_entries
--   where ended_at is null group by user_id having count(*) > 1;
-- ─────────────────────────────────────────────────────────────────────────────
