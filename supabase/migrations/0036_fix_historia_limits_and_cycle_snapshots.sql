-- Corrige los límites de historias en los planes y sincroniza los snapshots
-- de los ciclos activos para que reflejen los valores correctos.
--
-- Básico: 8 · Profesional: 20 · Premium: 24
--
-- Usa ILIKE para tolerar diferencias de mayúsculas y acento ('básico' / 'Basico').
-- Los ciclos cerrados NO se modifican — solo los ciclos en status = 'current'.

-- ── 1. Planes ──────────────────────────────────────────────────────────────

UPDATE plans
SET limits_json = limits_json || '{"historias": 8}'::jsonb
WHERE name ILIKE '%sico%'           -- básico, Basico, Básico …
  AND name NOT ILIKE '%cl%sico%';   -- excluye "clásico" si existiera

UPDATE plans
SET limits_json = limits_json || '{"historias": 20}'::jsonb
WHERE name ILIKE '%profesional%';

UPDATE plans
SET limits_json = limits_json || '{"historias": 24}'::jsonb
WHERE name ILIKE '%premium%';

-- ── 2. Ciclos activos ──────────────────────────────────────────────────────
-- Sobreescribe limits_snapshot_json.historias con el valor del plan actual del cliente.
-- El rollover (rollover_from_previous_json.historias) sigue sumándose en la app.

UPDATE billing_cycles bc
SET limits_snapshot_json = bc.limits_snapshot_json ||
  jsonb_build_object(
    'historias',
    (
      SELECT (p.limits_json ->> 'historias')::int
      FROM clients c
      JOIN plans p ON c.current_plan_id = p.id
      WHERE c.id = bc.client_id
        AND p.limits_json ? 'historias'
    )
  )
WHERE bc.status = 'current'
  AND EXISTS (
    SELECT 1
    FROM clients c
    JOIN plans p ON c.current_plan_id = p.id
    WHERE c.id = bc.client_id
      AND p.limits_json ? 'historias'
  );
