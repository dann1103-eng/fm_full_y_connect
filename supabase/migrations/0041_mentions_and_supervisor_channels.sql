-- ============================================================
-- FM CRM — Migration 0041: Menciones en requerimientos + permisos supervisor
-- ============================================================
-- Agrega:
--   1. Helper is_admin_or_supervisor() (equivalente a is_admin pero incluye supervisor)
--   2. Tabla requirement_mentions (satélite de requirement_messages)
--   3. Actualiza policies de 0040 para permitir crear/gestionar canales a supervisores
--
-- IMPORTANTE: reescribe policies de conversations y conversation_members
-- creadas en 0040. Usa DROP POLICY IF EXISTS antes de CREATE.
-- ============================================================

-- ── Helper: role in (admin, supervisor) ──────────────────────
CREATE OR REPLACE FUNCTION public.is_admin_or_supervisor()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT (SELECT role FROM public.users WHERE id = auth.uid())
         IN ('admin','supervisor');
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_or_supervisor() TO authenticated;

-- ── requirement_mentions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.requirement_mentions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id            uuid        NOT NULL REFERENCES public.requirement_messages(id) ON DELETE CASCADE,
  requirement_id        uuid        NOT NULL REFERENCES public.requirements(id) ON DELETE CASCADE,
  mentioned_user_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  mentioned_by_user_id  uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  read_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT requirement_mentions_unique UNIQUE (message_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS requirement_mentions_user_inbox_idx
  ON public.requirement_mentions (mentioned_user_id, read_at, created_at DESC);

ALTER TABLE public.requirement_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own mentions"
  ON public.requirement_mentions FOR SELECT
  USING (mentioned_user_id = auth.uid());

-- INSERT se hace desde server action con admin client; no hay política de INSERT pública.

CREATE POLICY "Users mark their mentions as read"
  ON public.requirement_mentions FOR UPDATE
  USING (mentioned_user_id = auth.uid());

-- ── Reescribir policies de 0040 (conversations) ──────────────
DROP POLICY IF EXISTS "Any agency user can create DMs; only admins create channels"
  ON public.conversations;

CREATE POLICY "Any agency user can create DMs; admin/supervisor create channels"
  ON public.conversations FOR INSERT
  WITH CHECK (
    public.is_agency_user() AND (
      type = 'dm' OR public.is_admin_or_supervisor()
    )
  );

DROP POLICY IF EXISTS "Admins can update channel metadata"
  ON public.conversations;

CREATE POLICY "Admin or supervisor can update channel metadata"
  ON public.conversations FOR UPDATE
  USING (type = 'channel' AND public.is_admin_or_supervisor());

DROP POLICY IF EXISTS "Admins can delete channels"
  ON public.conversations;

CREATE POLICY "Admin or supervisor can delete channels"
  ON public.conversations FOR DELETE
  USING (type = 'channel' AND public.is_admin_or_supervisor());

-- ── Reescribir policies de 0040 (conversation_members) ───────
DROP POLICY IF EXISTS "Users can leave a conversation or admins can expel from channels"
  ON public.conversation_members;

CREATE POLICY "Users leave or admin/supervisor expel from channels"
  ON public.conversation_members FOR DELETE
  USING (
    user_id = auth.uid()
    OR (
      public.is_admin_or_supervisor()
      AND EXISTS (
        SELECT 1 FROM public.conversations c
         WHERE c.id = conversation_id AND c.type = 'channel'
      )
    )
  );
