-- 0057_billing_automation.sql
-- Auto-billing + biweekly invoice support.

alter table clients
  add column if not exists auto_billing boolean not null default false,
  add column if not exists is_foreign   boolean not null default false;

alter table invoices
  add column if not exists biweekly_half text
    check (biweekly_half in ('first','second'))
    default null;

-- 'first'  covers S1-S2; its payment updates billing_cycles.payment_status.
-- 'second' covers S3-S4; its payment updates billing_cycles.payment_status_2.
-- null     = monthly invoice or extra (no biweekly semantics).

create index if not exists idx_invoices_cycle_half
  on invoices (billing_cycle_id, biweekly_half)
  where billing_cycle_id is not null;

-- Nuevo estado 'scheduled' para ciclos pre-creados por el auto-billing.
-- Un ciclo 'scheduled' aún no ha iniciado; al expirar el ciclo 'current' anterior,
-- el cron lo promueve a 'current'.
alter table billing_cycles
  drop constraint if exists billing_cycles_status_check;

alter table billing_cycles
  add constraint billing_cycles_status_check
  check (status in ('current', 'archived', 'pending_renewal', 'scheduled'));

create index if not exists idx_billing_cycles_client_scheduled
  on billing_cycles (client_id)
  where status = 'scheduled';
