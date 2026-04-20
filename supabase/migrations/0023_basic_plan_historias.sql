-- Plan Básico: incluir 3 historias/semana explícitamente en la distribución default.
-- Los ceros explícitos en reel/video_corto impiden que augmentDistribution añada
-- fallbacks automáticos (ceil(limit/4)) para esos tipos en las semanas donde no aplican.
UPDATE plans
SET default_weekly_distribution_json = '{
  "S1": {"historia": 3, "video_corto": 1, "estatico": 1, "reel": 0},
  "S2": {"historia": 3, "reel": 1, "estatico": 1, "video_corto": 0},
  "S3": {"historia": 3, "video_corto": 1, "estatico": 1, "reel": 0},
  "S4": {"historia": 3, "reel": 1, "estatico": 1, "video_corto": 0}
}'::jsonb
WHERE price_usd = 200;
