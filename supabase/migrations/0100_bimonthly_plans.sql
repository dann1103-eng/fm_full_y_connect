-- 0100 — Planes bimestrales (60 días, 8 semanas, 2 pagos manuales)
--
-- 1) Extiende billing_period a 'bimonthly' en clients y billing_cycles.
-- 2) Añade plans.billing_period (default 'monthly') para que un plan defina
--    su periodicidad por defecto; ClientForm la copia al asignar el plan.
-- 3) Reescribe el trigger requirements_check_week_payment para soportar 8 semanas
--    cuando billing_period = 'bimonthly' (S1-S4 → payment_status, S5-S8 → payment_status_2).
--    Mensual y biweekly mantienen comportamiento idéntico.

-- ── 1) Extender CHECK constraint de billing_period ────────────────────────
alter table public.clients drop constraint if exists clients_billing_period_check;
alter table public.clients add constraint clients_billing_period_check
  check (billing_period in ('monthly','biweekly','bimonthly'));

alter table public.billing_cycles drop constraint if exists billing_cycles_billing_period_check;
alter table public.billing_cycles add constraint billing_cycles_billing_period_check
  check (billing_period in ('monthly','biweekly','bimonthly'));

-- ── 2) plans.billing_period (default monthly) ─────────────────────────────
alter table public.plans
  add column if not exists billing_period text not null default 'monthly';

alter table public.plans drop constraint if exists plans_billing_period_check;
alter table public.plans add constraint plans_billing_period_check
  check (billing_period in ('monthly','biweekly','bimonthly'));

comment on column public.plans.billing_period is
  'Periodicidad por defecto del plan. Al asignar el plan a un cliente, se copia a clients.billing_period y al snapshot del ciclo. bimonthly = 60 días con 8 semanas, 2 pagos manuales (split día 30).';

-- ── 3) Reescribir trigger para soportar 8 semanas en bimonthly ────────────
create or replace function public.requirements_check_week_payment()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_cycle        record;
  v_reg_date     date;
  v_week         int;
  v_max_week     int;
  v_paid         boolean;
  v_grace_active boolean;
begin
  if TG_OP <> 'INSERT' then return new; end if;

  select bc.period_start,
         bc.payment_status,
         bc.payment_status_2,
         bc.grace_period_until,
         bc.billing_period,
         c.status as client_status,
         c.name as client_name
    into v_cycle
  from public.billing_cycles bc
  join public.clients c on c.id = bc.client_id
  where bc.id = new.billing_cycle_id;

  if v_cycle is null then
    raise exception 'Ciclo de facturación no encontrado.' using errcode = '23503';
  end if;

  -- Bloqueo incondicional por suspensión
  if v_cycle.client_status = 'inactive_payment' then
    raise exception 'Cliente % suspendido por falta de pago.', v_cycle.client_name
      using errcode = 'P0001';
  end if;
  if v_cycle.client_status = 'inactive_manual' then
    raise exception 'Cliente % desactivado.', v_cycle.client_name
      using errcode = 'P0001';
  end if;

  -- Gracia vigente sobreescribe el chequeo de pago
  v_grace_active := v_cycle.grace_period_until is not null
                    and v_cycle.grace_period_until >= current_date;

  -- Cap de semanas según billing_period: bimonthly = 8, demás = 4
  v_max_week := case when v_cycle.billing_period = 'bimonthly' then 8 else 4 end;

  -- Calcular semana con aritmética entera (date - date = int)
  v_reg_date := coalesce(new.registered_at, now())::date;
  v_week := least(v_max_week, greatest(1,
    ((v_reg_date - v_cycle.period_start) / 7)::int + 1
  ));

  -- Mapear semana a estado de pago según billing_period
  if v_cycle.billing_period = 'biweekly' then
    -- 4 semanas: S1-S2 → payment_status, S3-S4 → payment_status_2
    if v_week <= 2 then
      v_paid := (v_cycle.payment_status = 'paid');
    else
      v_paid := (v_cycle.payment_status_2 = 'paid');
    end if;
  elsif v_cycle.billing_period = 'bimonthly' then
    -- 8 semanas: S1-S4 → payment_status, S5-S8 → payment_status_2
    if v_week <= 4 then
      v_paid := (v_cycle.payment_status = 'paid');
    else
      v_paid := (v_cycle.payment_status_2 = 'paid');
    end if;
  else
    -- monthly: todas las semanas gateadas por payment_status
    v_paid := (v_cycle.payment_status = 'paid');
  end if;

  if not v_paid and not v_grace_active then
    raise exception 'No se puede registrar requerimientos en la semana % sin el pago correspondiente.', v_week
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;
