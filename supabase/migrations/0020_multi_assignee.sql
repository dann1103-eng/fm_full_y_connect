-- Convert requirements.assigned_to from uuid to uuid[] for multi-assignee support

-- Drop FK constraint (uuid[] cannot have FK constraints in PostgreSQL)
ALTER TABLE requirements DROP CONSTRAINT IF EXISTS requirements_assigned_to_fkey;

-- Drop existing btree index
DROP INDEX IF EXISTS idx_requirements_assigned_to;

-- Convert column to uuid[] preserving existing single assignments
ALTER TABLE requirements
  ALTER COLUMN assigned_to TYPE uuid[]
  USING CASE WHEN assigned_to IS NULL THEN NULL ELSE ARRAY[assigned_to] END;

-- GIN index for @> containment queries (used by operator scoping filter)
CREATE INDEX idx_requirements_assigned_to ON requirements USING GIN (assigned_to)
  WHERE assigned_to IS NOT NULL;
