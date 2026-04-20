-- Allow admins and supervisors to update/delete time entries that belong to any user.
-- The existing policies only allow users to manage their OWN entries, so admin edits
-- and deletes on other users' entries were being silently blocked by RLS.

CREATE POLICY "Admins can update any time entry"
  ON public.time_entries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('admin', 'supervisor')
    )
  );

CREATE POLICY "Admins can delete any time entry"
  ON public.time_entries FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('admin', 'supervisor')
    )
  );
