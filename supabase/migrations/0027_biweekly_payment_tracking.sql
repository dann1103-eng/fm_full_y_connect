-- Facturación quincenal con 2 pagos por ciclo.
-- Hasta ahora el ciclo tenía un solo `payment_status`/`payment_date`. Para biweekly
-- necesitamos separar 1er pago (cubre S1-S2) y 2do pago (cubre S3-S4).
-- Los ciclos monthly usan solo `payment_status`/`payment_date` como antes.
ALTER TABLE billing_cycles
  ADD COLUMN IF NOT EXISTS payment_status_2 text
    DEFAULT 'unpaid'
    CHECK (payment_status_2 IN ('unpaid', 'paid', 'pending', 'overdue')),
  ADD COLUMN IF NOT EXISTS payment_date_2 timestamptz;

COMMENT ON COLUMN billing_cycles.payment_status IS
  'Estado del 1er pago (monthly) o 1ra quincena (biweekly).';
COMMENT ON COLUMN billing_cycles.payment_status_2 IS
  'Estado del 2do pago biweekly. NULL/unpaid si monthly o no aplicable.';
