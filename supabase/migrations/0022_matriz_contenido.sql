-- Add matrices_contenido = 1 to all existing plans
UPDATE plans
SET limits_json = limits_json || '{"matrices_contenido": 1}'::jsonb;

-- Also patch any existing billing_cycle snapshots so they inherit the field
-- (prevents old cycles from showing limit=0 on the new type)
UPDATE billing_cycles
SET limits_snapshot_json = limits_snapshot_json || '{"matrices_contenido": 1}'::jsonb
WHERE limits_snapshot_json IS NOT NULL;
