-- 0094_requirements_payment_gate.sql
-- Defensa en profundidad: bloquea inserts de requirements cuando la semana
-- correspondiente del ciclo no está pagada, o cuando el cliente está suspendido.
--
-- El trigger se ejecuta BEFORE INSERT a nivel DB, así que cualquier path
-- (browser, portal, server action, devtools, IA worker) queda bloqueado.
-- La validación de cliente_status también detiene inserts a clientes
-- desactivados manualmente o por impago.

create or replace function public.requirements_check_week_payment()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_cycle    record;
  v_reg_date date;
  v_week     int;
  v_paid     boolean;
begin
  if TG_OP <> 'INSERT' then return new; end if;

  select bc.period_start,
         bc.payment_status,
         bc.payment_status_2,
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

  -- Bloqueo por status del cliente
  if v_cycle.client_status = 'inactive_payment' then
    raise exception 'Cliente % suspendido por falta de pago.', v_cycle.client_name
      using errcode = 'P0001';
  end if;
  if v_cycle.client_status = 'inactive_manual' then
    raise exception 'Cliente % desactivado.', v_cycle.client_name
      using errcode = 'P0001';
  end if;

  -- Calcular semana 1..4 según fecha de registro vs period_start
  v_reg_date := coalesce(new.registered_at, now())::date;
  v_week := least(4, greatest(1,
    floor(extract(epoch from (v_reg_date - v_cycle.period_start)) / 86400 / 7)::int + 1
  ));

  -- Validar pago de la semana correspondiente
  if v_cycle.billing_period = 'biweekly' then
    if v_week <= 2 then
      v_paid := (v_cycle.payment_status = 'paid');
    else
      v_paid := (v_cycle.payment_status_2 = 'paid');
    end if;
  else
    -- monthly: todas las semanas gateadas por payment_status
    v_paid := (v_cycle.payment_status = 'paid');
  end if;

  if not v_paid then
    raise exception 'No se puede registrar requerimientos en la semana % sin el pago correspondiente.', v_week
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists requirements_check_week_payment_trg on public.requirements;
create trigger requirements_check_week_payment_trg
  before insert on public.requirements
  for each row execute function public.requirements_check_week_payment();
