-- Fase B: Propiedades de requerimiento (prioridad, tiempo estimado, asignado)
ALTER TABLE requirements
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'media'
    CHECK (priority IN ('baja','media','alta')),
  ADD COLUMN IF NOT EXISTS estimated_time_minutes integer,
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_requirements_assigned_to ON requirements(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_requirements_priority ON requirements(priority);
