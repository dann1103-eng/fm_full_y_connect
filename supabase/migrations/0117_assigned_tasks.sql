-- 0116_assigned_tasks.sql
-- Tareas asignadas: supervisores/admins asignan tareas específicas (fuera del
-- plan de contenido de un cliente) a miembros del equipo. El responsable
-- registra tiempo contra la tarea hasta marcarla como finalizada.
--
-- El TIEMPO se registra en `time_entries` (nuevo entry_type='task' + task_id),
-- por lo que cuenta como productividad automáticamente (endShift ya suma todas
-- las time_entries de la jornada) y aparece en /tiempo sin código extra.
-- La METADATA de la tarea (título, responsable, estado, etc.) vive en esta
-- tabla nueva `assigned_tasks`.

-- ── 1. Tabla assigned_tasks ──────────────────────────────────────────────────
create table if not exists public.assigned_tasks (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null,
  description          text,
  client_ref           text,                       -- referencia de cliente en texto libre
  assigned_to_user_id  uuid not null references public.users(id),
  created_by_user_id   uuid not null references public.users(id),
  status               text not null default 'pending'
                         check (status in ('pending','in_progress','done','cancelled')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  started_at           timestamptz,                -- 1ª vez que pasó a in_progress
  completed_at         timestamptz,                -- cuándo se marcó done
  cancelled_at         timestamptz                 -- cuándo se canceló/archivó
);

create index if not exists assigned_tasks_assignee_idx
  on public.assigned_tasks (assigned_to_user_id, status);
create index if not exists assigned_tasks_creator_idx
  on public.assigned_tasks (created_by_user_id, status);

-- touch updated_at en cada UPDATE
create or replace function public.touch_assigned_tasks_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists assigned_tasks_touch_updated_at on public.assigned_tasks;
create trigger assigned_tasks_touch_updated_at
  before update on public.assigned_tasks
  for each row execute function public.touch_assigned_tasks_updated_at();

-- ── 2. time_entries: soportar entradas de tipo 'task' ────────────────────────
alter table public.time_entries
  add column if not exists task_id uuid references public.assigned_tasks(id) on delete set null;

-- Extender el CHECK de entry_type (era IN ('requirement','administrative') en 0014)
alter table public.time_entries
  drop constraint if exists time_entries_entry_type_check;
alter table public.time_entries
  add constraint time_entries_entry_type_check
  check (entry_type in ('requirement','administrative','task'));

-- Consistencia por tipo: cada entry_type exige/prohíbe sus columnas.
-- Reemplaza el constraint de 0014 agregando la rama 'task' y asegurando que
-- las ramas existentes tengan task_id NULL. Las filas legacy (todas con
-- task_id NULL) siguen cumpliendo, así que no requiere migración de datos.
alter table public.time_entries
  drop constraint if exists time_entries_type_check;
alter table public.time_entries
  add constraint time_entries_type_check check (
    (entry_type = 'requirement'    and requirement_id is not null and category is null     and task_id is null)
    or (entry_type = 'administrative' and category is not null     and requirement_id is null and task_id is null)
    or (entry_type = 'task'           and task_id is not null       and requirement_id is null and category is null)
  );

create index if not exists time_entries_task_id_idx
  on public.time_entries (task_id) where task_id is not null;

-- ── 3. RLS de assigned_tasks ─────────────────────────────────────────────────
alter table public.assigned_tasks enable row level security;

-- SELECT: el responsable ve las suyas; admin/supervisor ven todas.
drop policy if exists "assigned_tasks_select" on public.assigned_tasks;
create policy "assigned_tasks_select"
  on public.assigned_tasks for select
  using (
    assigned_to_user_id = auth.uid()
    or exists (
      select 1 from public.users
      where id = auth.uid() and role in ('admin','supervisor')
    )
  );

-- INSERT: solo admin/supervisor, y deben registrarse como creador.
drop policy if exists "assigned_tasks_insert" on public.assigned_tasks;
create policy "assigned_tasks_insert"
  on public.assigned_tasks for insert
  with check (
    created_by_user_id = auth.uid()
    and exists (
      select 1 from public.users
      where id = auth.uid() and role in ('admin','supervisor')
    )
  );

-- UPDATE: solo admin/supervisor (editar, reasignar, cancelar).
-- Las transiciones de estado del responsable (pending→in_progress al iniciar el
-- timer, →done al finalizar) se hacen vía server action con service role tras
-- verificar identidad — NO se le da UPDATE amplio al operador sobre la fila.
drop policy if exists "assigned_tasks_update_staff" on public.assigned_tasks;
create policy "assigned_tasks_update_staff"
  on public.assigned_tasks for update
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role in ('admin','supervisor')
    )
  )
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid() and role in ('admin','supervisor')
    )
  );
