-- Plan "Contenido": pool único de N contenidos tipables al registrar.
-- Se agrega columna top-level en plans para query/filtrado fácil; el mismo valor
-- se copia también dentro de limits_snapshot_json al crear el billing_cycle,
-- para que el snapshot sea autosuficiente aun si el plan cambia después.
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS unified_content_limit integer;

COMMENT ON COLUMN plans.unified_content_limit IS
  'NULL = plan normal (limits per-type). N = todos los tipos tippables comparten un pool único de N.';

-- Insertar el plan "Contenido" (idempotente por nombre).
INSERT INTO plans (name, price_usd, cambios_included, active, unified_content_limit, limits_json)
SELECT
  'Contenido',
  120,
  1,
  true,
  10,
  '{
    "historias": 0,
    "estaticos": 0,
    "videos_cortos": 0,
    "reels": 0,
    "shorts": 0,
    "producciones": 0,
    "reuniones": 0,
    "reunion_duracion_horas": 0,
    "matrices_contenido": 0,
    "unified_content_limit": 10
  }'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = 'Contenido');
