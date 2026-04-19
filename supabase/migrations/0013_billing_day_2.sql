-- Phase 3: segundo día de facturación para clientes quincenales

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS billing_day_2 int
  CHECK (billing_day_2 BETWEEN 1 AND 31);
