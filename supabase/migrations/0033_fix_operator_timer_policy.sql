-- Fix: "Operators can close their own active timer" fails with RLS error because
-- without an explicit WITH CHECK, Postgres reuses the USING clause to validate
-- the row AFTER the update — but ended_at is no longer NULL after closing,
-- so the post-update check fails and the operation is rejected.
--
-- Solution: add an explicit WITH CHECK that only verifies ownership + role,
-- without the ended_at IS NULL restriction (which only needs to apply before).

DROP POLICY IF EXISTS "Operators can close their own active timer" ON public.time_entries;

CREATE POLICY "Operators can close their own active timer"
  ON public.time_entries FOR UPDATE
  USING (
    -- Only allow updating rows that are still open (active timer)
    auth.uid() = user_id
    AND ended_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'operator'
    )
  )
  WITH CHECK (
    -- After the update, only verify ownership + role (ended_at will now be set)
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'operator'
    )
  );
