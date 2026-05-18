-- 0095_fix_requirements_week_calc.sql
-- Fix bug introducido en 0094: el cálculo de semana usaba
-- `extract(epoch from (date - date))` pero en postgres `date - date`
-- retorna `integer` (días), no `interval`. `extract(epoch from <int>)`
-- falla con error de tipo y rechaza TODOS los inserts de requirements.
--
-- Fix: usar aritmética entera directa sobre la diferencia en días.
-- (v_reg_date - v_cycle.period_start) ya es integer days → /7 → +1.

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

  -- Calcular semana 1..4 según fecha de registro vs period_start.
  -- (date - date) en postgres es integer días, no interval — usar
  -- aritmética entera directa para evitar el bug del trigger original.
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

  if not v_paid then
    raise exception 'No se puede registrar requerimientos en la semana % sin el pago correspondiente.', v_week
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;
