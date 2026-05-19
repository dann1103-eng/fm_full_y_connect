-- 0096_billing_grace_period.sql
-- Agrega período de gracia por ciclo. Si grace_period_until >= current_date,
-- el cliente puede registrar requirements aunque el ciclo esté unpaid, y el
-- cron no lo suspende. Al expirar la fecha, el flujo normal de impago vuelve
-- a aplicar. Admin puede extender otorgando una nueva gracia (que reactiva
-- automáticamente si quedó suspendido).

alter table public.billing_cycles
  add column if not exists grace_period_until date,
  add column if not exists grace_period_granted_by uuid references public.users(id),
  add column if not exists grace_period_granted_at timestamptz;

create index if not exists billing_cycles_grace_period_idx
  on public.billing_cycles(grace_period_until)
  where grace_period_until is not null;

-- Reemplazar trigger 0094/0095: añadir override por gracia vigente.
-- Mantiene el fix de aritmética entera del 0095 ((date - date) es int, no interval).
create or replace function public.requirements_check_week_payment()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_cycle    record;
  v_reg_date date;
  v_week     int;
  v_paid     boolean;
  v_grace_active boolean;
begin
  if TG_OP <> 'INSERT' then return new; end if;

  select bc.period_start,
         bc.payment_status,
         bc.payment_status_2,
         bc.grace_period_until,
         c.billing_period,
         c.status as client_status,
         c.name as client_name
    into v_cycle
  from public.billing_cycles bc
  join public.clients c on c.id = bc.client_id
  where bc.id = new.billing_cycle_id;

  if v_cycle is null then
    raise exception 'Ciclo de facturación no encontrado.' using errcode = '23503';
  end if;

  -- Status de cliente bloquea inserts incondicionalmente. La gracia no aplica
  -- sobre clientes ya suspendidos: para reactivarlos hay que llamar la RPC
  -- reactivate_client (deferPaymentGracePeriod lo hace automáticamente).
  if v_cycle.client_status = 'inactive_payment' then
    raise exception 'Cliente % suspendido por falta de pago.', v_cycle.client_name
      using errcode = 'P0001';
  end if;
  if v_cycle.client_status = 'inactive_manual' then
    raise exception 'Cliente % desactivado.', v_cycle.client_name
      using errcode = 'P0001';
  end if;

  -- Gracia vigente: permite inserts aunque el ciclo esté unpaid
  v_grace_active := v_cycle.grace_period_until is not null
                    and v_cycle.grace_period_until >= current_date;

  -- Calcular semana 1..4 con aritmética entera (date - date = int)
  v_reg_date := coalesce(new.registered_at, now())::date;
  v_week := least(4, greatest(1,
    ((v_reg_date - v_cycle.period_start) / 7)::int + 1
  ));

  -- Validar pago de la semana correspondiente
  if v_cycle.billing_period = 'biweekly' then
    if v_week <= 2 then
      v_paid := (v_cycle.payment_status = 'paid');
    else
      v_paid := (v_cycle.payment_status_2 = 'paid');
    end if;
  else
    v_paid := (v_cycle.payment_status = 'paid');
  end if;

  if not v_paid and not v_grace_active then
    raise exception 'No se puede registrar requerimientos en la semana % sin el pago correspondiente.', v_week
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;
