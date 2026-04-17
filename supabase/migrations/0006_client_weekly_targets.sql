-- supabase/migrations/0006_client_weekly_targets.sql
-- ============================================================
-- FM CRM — Migration 0006: Weekly targets per client
-- ============================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS weekly_targets_json jsonb;
