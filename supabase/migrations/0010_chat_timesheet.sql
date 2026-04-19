-- ============================================================
-- FM CRM — Migration 0010: Chat interno + Hojas de tiempo
-- ============================================================

-- 1. Columna review_started_at en requirements
--    Se setea automáticamente cuando el requerimiento entra a revision_cliente
ALTER TABLE public.requirements
  ADD COLUMN IF NOT EXISTS review_started_at timestamptz;

-- 2. Tabla requirement_messages (chat interno por requerimiento)
CREATE TABLE IF NOT EXISTS public.requirement_messages (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  requirement_id  uuid        NOT NULL REFERENCES public.requirements(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body            text        NOT NULL CHECK (char_length(trim(body)) > 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.requirement_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agency users can view requirement messages"
  ON public.requirement_messages FOR SELECT
  USING (public.is_agency_user());

CREATE POLICY "Agency users can send requirement messages"
  ON public.requirement_messages FOR INSERT
  WITH CHECK (public.is_agency_user());

CREATE INDEX IF NOT EXISTS req_messages_requirement_id_idx
  ON public.requirement_messages(requirement_id);

-- 3. Tabla time_entries (hojas de tiempo por requerimiento)
CREATE TABLE IF NOT EXISTS public.time_entries (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  requirement_id      uuid        NOT NULL REFERENCES public.requirements(id) ON DELETE CASCADE,
  user_id             uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  phase               text        NOT NULL,
  title               text        NOT NULL DEFAULT '',
  started_at          timestamptz NOT NULL DEFAULT now(),
  ended_at            timestamptz,               -- null = timer activo
  duration_seconds    integer,                   -- null mientras corre el timer
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agency users can view time entries"
  ON public.time_entries FOR SELECT
  USING (public.is_agency_user());

CREATE POLICY "Agency users can insert time entries"
  ON public.time_entries FOR INSERT
  WITH CHECK (public.is_agency_user());

CREATE POLICY "Users can update their own time entries"
  ON public.time_entries FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own time entries"
  ON public.time_entries FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS time_entries_requirement_id_idx
  ON public.time_entries(requirement_id);

CREATE INDEX IF NOT EXISTS time_entries_user_id_idx
  ON public.time_entries(user_id);
