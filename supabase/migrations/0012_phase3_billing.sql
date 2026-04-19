-- Phase 3: periodo de facturación (mensual/quincenal) por cliente

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS billing_period text NOT NULL DEFAULT 'monthly'
  CHECK (billing_period IN ('monthly', 'biweekly'));
