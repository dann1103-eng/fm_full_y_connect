-- Phase 6A: Agregar rol 'supervisor' al sistema de permisos

-- Relajar el CHECK constraint de users.role para aceptar 'supervisor'
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'supervisor', 'operator'));
