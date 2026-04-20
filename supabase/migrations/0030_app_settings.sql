-- Tabla de configuración global de la aplicación (key-value).
-- Usada para almacenar la URL del logo de la agencia y otros ajustes futuros.
CREATE TABLE IF NOT EXISTS app_settings (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz DEFAULT now()
);

-- Fila inicial para el logo de la agencia (null = sin logo cargado aún)
INSERT INTO app_settings (key, value)
VALUES ('agency_logo_url', null)
ON CONFLICT (key) DO NOTHING;

-- Solo admins pueden modificar los ajustes; cualquier autenticado puede leer.
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage settings" ON app_settings
  FOR ALL USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Authenticated can read settings" ON app_settings
  FOR SELECT USING (auth.role() = 'authenticated');

-- ─────────────────────────────────────────────────────────────────────────────
-- BUCKET MANUAL en Supabase Dashboard:
--
--   Nombre:   agency-assets
--   Público:  sí
--   Policies:
--     - INSERT: authenticated
--     - SELECT: public  (bucket_id = 'agency-assets')
--     - UPDATE: authenticated con role='admin'
--     - DELETE: authenticated con role='admin'
-- ─────────────────────────────────────────────────────────────────────────────
