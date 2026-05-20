-- 0098 — Planes sin vencimiento
--
-- Agrega bandera no_expira en plans y billing_cycles.
-- Cuando un plan tiene no_expira=true, los ciclos creados con ese plan se
-- marcan no_expira=true en su snapshot. El cron daily-cycle-runner debe
-- ignorar (no archivar / no facturar auto) los ciclos con no_expira=true.

alter table public.plans
  add column if not exists no_expira boolean not null default false;

alter table public.billing_cycles
  add column if not exists no_expira boolean not null default false;

comment on column public.plans.no_expira is
  'Si true, los ciclos creados con este plan no se archivan automáticamente (cron salta su expiración).';

comment on column public.billing_cycles.no_expira is
  'Snapshot al crear el ciclo: si true, el cron salta el archivado por period_end vencido.';
