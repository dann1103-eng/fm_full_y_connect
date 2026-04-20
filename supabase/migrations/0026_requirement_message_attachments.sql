-- Attachments (imágenes) en el chat de requerimientos.
-- 1 imagen por mensaje; múltiples imágenes → múltiples messages.
-- Las imágenes se comprimen client-side a ≤800KB (presupuesto Supabase: 50MB TOTAL
-- entre todos los buckets). Se limpian al archivar ciclo, anular req o eliminar cliente.
ALTER TABLE requirement_messages
  ADD COLUMN IF NOT EXISTS attachment_path text,  -- path dentro del bucket "requirement-attachments"
  ADD COLUMN IF NOT EXISTS attachment_type text,  -- "image/jpeg", "image/png", "image/webp"
  ADD COLUMN IF NOT EXISTS attachment_name text;  -- nombre original (para descarga)

CREATE INDEX IF NOT EXISTS idx_req_messages_req
  ON requirement_messages(requirement_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- BUCKET MANUAL en Supabase Dashboard:
--
--   Nombre:   requirement-attachments
--   Público:  sí (paths contienen UUIDs, son opacos)
--   Policies:
--     - INSERT: authenticated (admin/supervisor/operator de la agencia)
--     - SELECT: public
--     - DELETE: authenticated con role='admin' en tabla users
--
-- ─────────────────────────────────────────────────────────────────────────────
