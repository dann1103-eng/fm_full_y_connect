-- Desglose stand-by vs trabajado por fase.
-- Al salir de una fase, se calcula:
--   worked_seconds  = SUM(duration_seconds) de time_entries en esa fase durante la ventana del log
--   standby_seconds = total_seconds - worked_seconds
-- Los logs históricos (sin ended_at) quedan como "fase actual" o "fase no cerrada".
ALTER TABLE requirement_phase_logs
  ADD COLUMN IF NOT EXISTS ended_at        timestamptz,
  ADD COLUMN IF NOT EXISTS standby_seconds integer,
  ADD COLUMN IF NOT EXISTS worked_seconds  integer;

-- Índice para localizar rápido el log abierto de un requerimiento al mover fase
CREATE INDEX IF NOT EXISTS idx_phase_logs_req_created
  ON requirement_phase_logs(requirement_id, created_at);
