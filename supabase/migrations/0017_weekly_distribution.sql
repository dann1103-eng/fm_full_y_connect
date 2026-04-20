-- Fase D: distribución semanal por tipo S1–S4

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS default_weekly_distribution_json jsonb;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS weekly_distribution_json jsonb;

-- Básico (price_usd = 200): 1 corto + 1 estático S1/S3, 1 reel + 1 estático S2/S4
UPDATE plans
SET default_weekly_distribution_json = '{
  "S1": {"video_corto": 1, "estatico": 1},
  "S2": {"reel": 1, "estatico": 1},
  "S3": {"video_corto": 1, "estatico": 1},
  "S4": {"reel": 1, "estatico": 1}
}'::jsonb
WHERE price_usd = 200;
