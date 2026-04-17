-- ============================================================
-- FM CRM — Migration 0005: Additional client social / contact fields
-- ============================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS yt_handle       text,
  ADD COLUMN IF NOT EXISTS linkedin_handle  text,
  ADD COLUMN IF NOT EXISTS website_url      text,
  ADD COLUMN IF NOT EXISTS other_contact    text;
