-- ============================================================
-- FM CRM — Migration 0040: Inbox de chat interno entre miembros del equipo
-- ============================================================
-- Soporta DMs 1-a-1 entre cualquier par de usuarios y canales por tema
-- creados únicamente por admin. Polling-based (no Realtime).
-- Incluye adjuntos de archivos/imágenes en bucket privado.
-- ============================================================

-- ── conversations ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversations (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type              text        NOT NULL CHECK (type IN ('dm','channel')),
  name              text,
  description       text,
  topic             text,
  created_by        uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_message_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_channel_requires_name
    CHECK (type <> 'channel' OR (name IS NOT NULL AND char_length(trim(name)) > 0))
);

-- Nombre de canal único (case-insensitive) cuando aplica
CREATE UNIQUE INDEX IF NOT EXISTS conversations_channel_name_unique
  ON public.conversations (LOWER(name))
  WHERE type = 'channel';

CREATE INDEX IF NOT EXISTS conversations_last_message_at_idx
  ON public.conversations (last_message_at DESC);

-- ── conversation_members ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversation_members (
  conversation_id   uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id           uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at         timestamptz NOT NULL DEFAULT now(),
  last_read_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conversation_members_user_id_idx
  ON public.conversation_members (user_id);

-- ── messages ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id           uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  body              text        NOT NULL DEFAULT '',
  edited_at         timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON public.messages (conversation_id, created_at DESC);

-- ── message_attachments ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_attachments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    uuid        NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  storage_path  text        NOT NULL,
  file_name     text        NOT NULL,
  file_size     bigint,
  mime_type     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_attachments_message_id_idx
  ON public.message_attachments (message_id);

-- ── Trigger: mantener last_message_at actualizado ────────────
CREATE OR REPLACE FUNCTION public.bump_conversation_last_message()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.conversations
     SET last_message_at = NEW.created_at
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bump_conversation_last_message_on_insert ON public.messages;
CREATE TRIGGER bump_conversation_last_message_on_insert
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE PROCEDURE public.bump_conversation_last_message();

-- ── Helper: membership check (SECURITY DEFINER para evitar recursión RLS) ─
CREATE OR REPLACE FUNCTION public.is_conversation_member(conv_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members
     WHERE conversation_id = conv_id
       AND user_id = auth.uid()
  );
$$;

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.conversations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments   ENABLE ROW LEVEL SECURITY;

-- conversations
CREATE POLICY "Members can view their conversations"
  ON public.conversations FOR SELECT
  USING (public.is_conversation_member(id));

CREATE POLICY "Any agency user can create DMs; only admins create channels"
  ON public.conversations FOR INSERT
  WITH CHECK (
    public.is_agency_user() AND (
      type = 'dm' OR public.is_admin()
    )
  );

CREATE POLICY "Admins can update channel metadata"
  ON public.conversations FOR UPDATE
  USING (type = 'channel' AND public.is_admin());

CREATE POLICY "Admins can delete channels"
  ON public.conversations FOR DELETE
  USING (type = 'channel' AND public.is_admin());

-- conversation_members
CREATE POLICY "Users see their own membership rows"
  ON public.conversation_members FOR SELECT
  USING (user_id = auth.uid() OR public.is_conversation_member(conversation_id));

CREATE POLICY "Users can update their own membership (last_read_at)"
  ON public.conversation_members FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can leave a conversation or admins can expel from channels"
  ON public.conversation_members FOR DELETE
  USING (
    user_id = auth.uid()
    OR (
      public.is_admin()
      AND EXISTS (
        SELECT 1 FROM public.conversations c
         WHERE c.id = conversation_id AND c.type = 'channel'
      )
    )
  );

-- Nota: INSERT en conversation_members se realiza desde server actions con
-- admin client (service role) para bootstrapear DMs idempotentes y agregar
-- miembros a canales. No se expone política de INSERT a clientes.

-- messages
CREATE POLICY "Members can view non-deleted messages"
  ON public.messages FOR SELECT
  USING (public.is_conversation_member(conversation_id) AND deleted_at IS NULL);

CREATE POLICY "Members can send messages as themselves"
  ON public.messages FOR INSERT
  WITH CHECK (
    public.is_conversation_member(conversation_id)
    AND user_id = auth.uid()
  );

CREATE POLICY "Authors can edit their messages"
  ON public.messages FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Authors can delete their messages"
  ON public.messages FOR DELETE
  USING (user_id = auth.uid());

-- message_attachments
CREATE POLICY "Members can view attachments of visible messages"
  ON public.message_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
       WHERE m.id = message_attachments.message_id
         AND public.is_conversation_member(m.conversation_id)
         AND m.deleted_at IS NULL
    )
  );

CREATE POLICY "Members can insert attachments to their messages"
  ON public.message_attachments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.messages m
       WHERE m.id = message_attachments.message_id
         AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "Author or admin can delete attachments"
  ON public.message_attachments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
       WHERE m.id = message_attachments.message_id
         AND (m.user_id = auth.uid() OR public.is_admin())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- BUCKET MANUAL en Supabase Dashboard:
--
--   Nombre:   chat-attachments
--   Público:  no (privado; se sirven con signed URLs desde el server)
--   Convención de path: {conversation_id}/{message_id}/{filename}
--
--   Policies sugeridas (crear en Dashboard → Storage → Policies):
--
--   a) INSERT (subir adjunto):
--        authenticated, WITH CHECK:
--          public.is_conversation_member( (storage.foldername(name))[1]::uuid )
--
--   b) SELECT (descargar con signed URL o directo si se hiciera público):
--        authenticated, USING:
--          public.is_conversation_member( (storage.foldername(name))[1]::uuid )
--
--   c) DELETE:
--        authenticated, USING:
--          public.is_conversation_member( (storage.foldername(name))[1]::uuid )
--          AND public.is_admin()  -- opcional: restringir borrado a admin
--
--   Límite recomendado por archivo: 10 MB (configurar en Dashboard).
--
-- ─────────────────────────────────────────────────────────────────────────────
