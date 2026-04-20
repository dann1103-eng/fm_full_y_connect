-- Operators should only be able to open (INSERT) and close (stop timer) their own
-- time entries. They must not be able to edit completed entries or delete anything.
--
-- Currently the generic "Users can update/delete their own time entries" policies
-- grant full UPDATE and DELETE to every authenticated user, including operators.
--
-- Fix:
--   1. Drop the generic update/delete policies.
--   2. Re-create update as admin+supervisor only (full edit of own entries).
--   3. Add a narrow "Operators can close their own active timer" policy that only
--      allows UPDATE on rows where ended_at IS NULL (the running timer row).
--   4. Re-create delete as admin+supervisor only.

-- ── Update ──────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can update their own time entries" ON public.time_entries;

-- Admins and supervisors: full update on their own entries
CREATE POLICY "Users can update their own time entries"
  ON public.time_entries FOR UPDATE
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('admin', 'supervisor')
    )
  );

-- Operators: can ONLY stop an active timer (ended_at IS NULL → sets ended_at)
CREATE POLICY "Operators can close their own active timer"
  ON public.time_entries FOR UPDATE
  USING (
    auth.uid() = user_id
    AND ended_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'operator'
    )
  );

-- ── Delete ──────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users can delete their own time entries" ON public.time_entries;

-- Only admins and supervisors can delete their own entries
-- (the "Admins can delete any time entry" policy from 0031 already covers deleting others')
CREATE POLICY "Users can delete their own time entries"
  ON public.time_entries FOR DELETE
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('admin', 'supervisor')
    )
  );
