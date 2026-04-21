-- Permitir a usuarios no autenticados (anon) leer únicamente la fila
-- `agency_logo_url` de app_settings. Necesario para que la página /login
-- (que se renderiza sin sesión) pueda mostrar el logo de la agencia.

CREATE POLICY "Anon can read agency logo setting" ON app_settings
  FOR SELECT
  TO anon
  USING (key = 'agency_logo_url');
