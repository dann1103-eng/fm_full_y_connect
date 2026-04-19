-- Phase 5: extender time_entries para soportar entradas administrativas

ALTER TABLE time_entries
  ALTER COLUMN requirement_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'requirement'
    CHECK (entry_type IN ('requirement', 'administrative')),
  ADD COLUMN IF NOT EXISTS category text
    CHECK (category IN (
      'administrativa',
      'coordinacion_cuentas',
      'reunion_interna',
      'direccion_creativa',
      'direccion_comunicacion',
      'standby'
    ));

-- Un usuario solo puede tener una entrada activa a la vez (ended_at IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_active_per_user
  ON time_entries (user_id)
  WHERE ended_at IS NULL;

-- Constraint: requirement entries necesitan requirement_id; admin entries necesitan category
ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_type_check CHECK (
    (entry_type = 'requirement' AND requirement_id IS NOT NULL AND category IS NULL)
    OR
    (entry_type = 'administrative' AND category IS NOT NULL AND requirement_id IS NULL)
  );
