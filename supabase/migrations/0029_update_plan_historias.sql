-- Actualización de límite de historias por plan.
-- Básico: 8 · Profesional: 20 · Premium: 24
UPDATE plans SET limits_json = limits_json || '{"historias": 8}'::jsonb  WHERE name = 'Básico';
UPDATE plans SET limits_json = limits_json || '{"historias": 20}'::jsonb WHERE name = 'Profesional';
UPDATE plans SET limits_json = limits_json || '{"historias": 24}'::jsonb WHERE name = 'Premium';
