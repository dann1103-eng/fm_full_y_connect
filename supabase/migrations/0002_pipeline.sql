-- ============================================================
-- FM CRM — Migration 0002: Pipeline de producción
-- ============================================================

-- ── Columna phase en consumptions ────────────────────────────
ALTER TABLE public.consumptions
  ADD COLUMN phase text NOT NULL DEFAULT 'pendiente'
    CHECK (phase IN (
      'pendiente',
      'en_produccion',
      'revision_interna',
      'revision_cliente',
      'aprobado',
      'publicado'
    ));

-- ── consumption_phase_logs ───────────────────────────────────
CREATE TABLE public.consumption_phase_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumption_id  uuid NOT NULL REFERENCES public.consumptions(id) ON DELETE CASCADE,
  from_phase      text,
  to_phase        text NOT NULL,
  moved_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX phase_logs_consumption_id_idx
  ON public.consumption_phase_logs(consumption_id);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.consumption_phase_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agency users can view phase logs"
  ON public.consumption_phase_logs FOR SELECT
  USING (public.is_agency_user());

CREATE POLICY "Agency users can insert phase logs"
  ON public.consumption_phase_logs FOR INSERT
  WITH CHECK (public.is_agency_user());

-- No UPDATE / DELETE: logs son inmutables
