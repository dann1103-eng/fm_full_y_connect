-- Override semanal por ciclo. Guarda cómo el admin quiere redistribuir el contenido
-- dentro del ciclo cuando se sube o baja un límite. Formato idéntico al
-- default_weekly_distribution_json de plans: { S1: {...}, S2: {...}, ... }.

ALTER TABLE billing_cycles
  ADD COLUMN IF NOT EXISTS weekly_distribution_override_json jsonb;
