-- 0093_client_inactive_status.sql
-- Soporta suspensión automática de clientes por falta de pago.
-- La columna `clients.status` existe desde 0001_init con valores
-- ('active','paused','overdue'). Extendemos el check para añadir
-- 'inactive_payment' (cron marca al expirar ciclo sin pago) y
-- 'inactive_manual' (admin desactiva manualmente).

-- 1) Extender check constraint de status
alter table public.clients drop constraint if exists clients_status_check;
alter table public.clients
  add constraint clients_status_check
  check (status in ('active', 'paused', 'overdue', 'inactive_payment', 'inactive_manual'));

-- 2) Columnas auxiliares para auditar la desactivación
alter table public.clients
  add column if not exists deactivation_reason text,
  add column if not exists deactivated_at timestamptz;

create index if not exists clients_status_inactive_idx on public.clients(status)
  where status in ('inactive_payment', 'inactive_manual', 'overdue');

-- 3) RPC para el cron (service_role): desactivar por impago de un ciclo
create or replace function public.deactivate_client_for_unpaid_cycle(
  p_client_id uuid,
  p_cycle_id uuid
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.clients
  set status = 'inactive_payment',
      deactivation_reason = 'Ciclo ' || p_cycle_id::text || ' venció sin pago',
      deactivated_at = now()
  where id = p_client_id
    and status = 'active';   -- idempotente: solo si está activo
end;
$$;

-- 4) RPC inversa: admin/supervisor reactiva manualmente
create or replace function public.reactivate_client(p_client_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
begin
  update public.clients
  set status = 'active',
      deactivation_reason = null,
      deactivated_at = null
  where id = p_client_id;
end;
$$;

grant execute on function public.deactivate_client_for_unpaid_cycle(uuid, uuid)
  to service_role;
grant execute on function public.reactivate_client(uuid)
  to authenticated, service_role;
