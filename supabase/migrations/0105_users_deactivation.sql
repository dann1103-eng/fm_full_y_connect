-- Migración 0105: soft-delete de usuarios (desactivación)
--
-- Contexto: no se puede borrar en duro a un usuario con historial. Muchas tablas
-- referencian public.users(id) con FK RESTRICT, y en particular
-- requirements.registered_by_user_id es NOT NULL → cada requerimiento que el
-- usuario registró lo referencia obligatoriamente y no se puede anular. Por eso
-- auth.admin.deleteUser() falla con "Database error deleting user".
--
-- Solución: marcar el usuario como desactivado (conserva todo el historial),
-- ocultarlo de la lista de usuarios y banear su login en Auth. El borrado duro
-- se reserva para usuarios sin datos.

alter table public.users
  add column if not exists deactivated_at timestamptz;
