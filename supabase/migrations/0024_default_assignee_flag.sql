-- Flag para marcar usuarios que deben ser preseleccionados al crear un requerimiento.
-- El admin marcará manualmente (ej. Alejandra y Fabiola) desde /users.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS default_assignee boolean NOT NULL DEFAULT false;

-- Índice parcial opcional — la consulta siempre filtra por true y la cardinalidad es baja.
CREATE INDEX IF NOT EXISTS idx_users_default_assignee
  ON users(default_assignee)
  WHERE default_assignee = true;
