-- Log individual de cada cambio con descripción opcional

CREATE TABLE requirement_cambio_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id uuid NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  notes       text,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cambio_logs_requirement_id ON requirement_cambio_logs(requirement_id);

ALTER TABLE requirement_cambio_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users read cambio logs"
  ON requirement_cambio_logs FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Auth users insert cambio logs"
  ON requirement_cambio_logs FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
