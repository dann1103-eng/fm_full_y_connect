-- ============================================================
-- FM CRM — Migration 0004: Tipo de consumo "reunion"
-- ============================================================

-- 1. Actualizar CHECK constraint en consumptions
ALTER TABLE public.consumptions
  DROP CONSTRAINT consumptions_content_type_check;

ALTER TABLE public.consumptions
  ADD CONSTRAINT consumptions_content_type_check
  CHECK (content_type IN (
    'historia', 'estatico', 'video_corto', 'reel',
    'short', 'produccion', 'reunion'
  ));

-- 2. Agregar reuniones a los tres planes existentes
UPDATE public.plans
  SET limits_json = limits_json || '{"reuniones": 1, "reunion_duracion_horas": 1}'::jsonb
  WHERE name = 'Básico';

UPDATE public.plans
  SET limits_json = limits_json || '{"reuniones": 2, "reunion_duracion_horas": 1}'::jsonb
  WHERE name = 'Profesional';

UPDATE public.plans
  SET limits_json = limits_json || '{"reuniones": 2, "reunion_duracion_horas": 2}'::jsonb
  WHERE name = 'Premium';
