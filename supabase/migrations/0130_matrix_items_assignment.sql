-- 0130_matrix_items_assignment.sql
-- Creador de matrices · Bloque 2. Responsable y tiempo estimado por pieza: la matriz planifica
-- también el quién y el cuánto, y la conversión automática los copia al requerimiento.
-- Spec: docs/superpowers/specs/2026-09-17-creador-de-matrices-bloque-2-design.md

begin;
set local lock_timeout = '5s';

alter table public.content_matrix_items
  add column if not exists assigned_to uuid[],
  add column if not exists estimated_time_minutes integer;

-- Constraint con nombre explícito (convención de 0129), idempotente.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'content_matrix_items_est_minutes_chk'
      and conrelid = 'public.content_matrix_items'::regclass
  ) then
    alter table public.content_matrix_items
      add constraint content_matrix_items_est_minutes_chk
      check (estimated_time_minutes is null or estimated_time_minutes between 1 and 10080);
  end if;
end $$;

commit;
