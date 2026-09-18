-- 0130_matrix_items_assignment.sql
-- Creador de matrices · Bloque 2. Responsable y tiempo estimado por pieza: la matriz planifica
-- también el quién y el cuánto, y la conversión automática los copia al requerimiento.
-- Spec: docs/superpowers/specs/2026-09-17-creador-de-matrices-bloque-2-design.md

begin;
set local lock_timeout = '5s';

alter table public.content_matrix_items
  add column if not exists assigned_to uuid[],
  add column if not exists estimated_time_minutes integer,
  -- Momento en que la pieza quedó bloqueada. No sirve `updated_at`: cualquier edición del brief lo
  -- pisa, así que no puede ordenar ni fechar el aviso de piezas bloqueadas.
  add column if not exists blocked_at timestamptz;

-- El aviso derivado de /api/notifications filtra por status='blocked' y ordena por
-- `blocked_at desc nulls last, id desc`; lo consulta cada usuario de staff cada 60 s y hoy no hay
-- índice para ese filtro. El orden del índice replica el del query: `desc` implica `nulls first`,
-- así que sin el `nulls last` explícito (y sin el desempate por `id`) el índice no serviría para
-- ordenar y Postgres caería en un sort.
create index if not exists content_matrix_items_blocked_idx
  on public.content_matrix_items (blocked_at desc nulls last, id desc)
  where status = 'blocked';

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

-- Filas bloqueadas por una versión anterior no tienen blocked_at; datarlas con updated_at
-- evita el caso especial de nulos en el aviso. Idempotente: solo toca las que faltan.
update public.content_matrix_items
   set blocked_at = updated_at
 where status = 'blocked' and blocked_at is null;

commit;
