-- Phase 2: sistema de cambios global, contenido extra, overrides de ciclo

-- 1. Agregar cambios_included a plans
ALTER TABLE plans ADD COLUMN IF NOT EXISTS cambios_included integer NOT NULL DEFAULT 0;

-- Valores iniciales según precios estándar de FM
UPDATE plans SET cambios_included = 8  WHERE price_usd = 200;
UPDATE plans SET cambios_included = 20 WHERE price_usd = 300;
UPDATE plans SET cambios_included = 26 WHERE price_usd = 400;

-- 2. Nuevas columnas en billing_cycles
ALTER TABLE billing_cycles
  ADD COLUMN IF NOT EXISTS cambios_budget integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cambios_packages_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS extra_content_json   jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS content_limits_override_json jsonb;

-- 3. Eliminar max_cambios de clients (cambios ahora son globales por ciclo)
ALTER TABLE clients DROP COLUMN IF EXISTS max_cambios;

-- 4. cambios_count se mantiene en requirements como contador por pieza (sin límite)
--    La validación del presupuesto se hace a nivel de ciclo (suma vs cambios_budget)
