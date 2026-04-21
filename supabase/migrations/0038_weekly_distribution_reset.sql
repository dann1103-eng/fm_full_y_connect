-- Re-siembra el desglose semanal por defecto para los 3 planes desde cero.
-- Versiones previas sólo incluían el plan Básico y no contemplaban 'historia'.
--
-- Totales mensuales (consistentes con 0036):
--   Básico:       8 historias · 4 estáticos · 2 videos cortos · 2 reels
--   Profesional: 20 historias · 8 estáticos · 4 videos cortos · 4 reels
--   Premium:     24 historias · 8 estáticos · 8 videos cortos · 4 reels
--
-- Distribución semanal:
--   Básico       : 2/1/1/0 (S1), 2/1/0/1 (S2), 2/1/1/0 (S3), 2/1/0/1 (S4)
--   Profesional  : 5/2/1/1 igual en las 4 semanas
--   Premium      : 6/2/2/1 igual en las 4 semanas

-- Wipe
UPDATE plans SET default_weekly_distribution_json = NULL;

-- Básico
UPDATE plans
SET default_weekly_distribution_json = '{
  "S1": {"historia": 2, "estatico": 1, "video_corto": 1, "reel": 0},
  "S2": {"historia": 2, "estatico": 1, "video_corto": 0, "reel": 1},
  "S3": {"historia": 2, "estatico": 1, "video_corto": 1, "reel": 0},
  "S4": {"historia": 2, "estatico": 1, "video_corto": 0, "reel": 1}
}'::jsonb
WHERE name ILIKE '%sico%'
  AND name NOT ILIKE '%cl%sico%';

-- Profesional
UPDATE plans
SET default_weekly_distribution_json = '{
  "S1": {"historia": 5, "estatico": 2, "video_corto": 1, "reel": 1},
  "S2": {"historia": 5, "estatico": 2, "video_corto": 1, "reel": 1},
  "S3": {"historia": 5, "estatico": 2, "video_corto": 1, "reel": 1},
  "S4": {"historia": 5, "estatico": 2, "video_corto": 1, "reel": 1}
}'::jsonb
WHERE name ILIKE '%profesional%';

-- Premium
UPDATE plans
SET default_weekly_distribution_json = '{
  "S1": {"historia": 6, "estatico": 2, "video_corto": 2, "reel": 1},
  "S2": {"historia": 6, "estatico": 2, "video_corto": 2, "reel": 1},
  "S3": {"historia": 6, "estatico": 2, "video_corto": 2, "reel": 1},
  "S4": {"historia": 6, "estatico": 2, "video_corto": 2, "reel": 1}
}'::jsonb
WHERE name ILIKE '%premium%';
