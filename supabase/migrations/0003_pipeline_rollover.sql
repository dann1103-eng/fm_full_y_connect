-- ============================================================
-- FM CRM — Migration 0003: Pipeline rollover (carried_over)
-- ============================================================

ALTER TABLE public.consumptions
  ADD COLUMN carried_over boolean NOT NULL DEFAULT false;
