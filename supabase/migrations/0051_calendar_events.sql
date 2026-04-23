-- Calendar feature: adds scheduling fields to requirements and time_entries.
--
-- requirements.starts_at  — exact start timestamp for reunion/produccion types.
--                           Arts-type requirements continue using deadline (date, all-day).
--                           Legacy reunion/produccion rows keep starts_at NULL and will be
--                           shown as all-day events on their deadline until manually edited.
--
-- time_entries.scheduled_* — planned calendar events for internal meetings (no client).
--                            These are inserted by admins/supervisors from the calendar UI.
--                            The timer is NOT started automatically; users mark real time
--                            as always. To avoid conflicting with the one-active-timer
--                            constraint (ended_at IS NULL), server actions must set
--                            ended_at = scheduled_at (i.e. immediately "closed") when
--                            inserting scheduled events.

-- ── requirements ────────────────────────────────────────────────────────────

ALTER TABLE public.requirements
  ADD COLUMN starts_at timestamptz;

CREATE INDEX idx_requirements_starts_at
  ON public.requirements (starts_at)
  WHERE starts_at IS NOT NULL;

-- ── time_entries ─────────────────────────────────────────────────────────────

ALTER TABLE public.time_entries
  ADD COLUMN scheduled_at               timestamptz,
  ADD COLUMN scheduled_duration_minutes integer,
  ADD COLUMN scheduled_attendees        uuid[] DEFAULT '{}';

CREATE INDEX idx_time_entries_scheduled_at
  ON public.time_entries (scheduled_at)
  WHERE scheduled_at IS NOT NULL;

-- GIN index for attendee lookups: auth.uid() = any(scheduled_attendees)
CREATE INDEX idx_time_entries_scheduled_attendees
  ON public.time_entries USING GIN (scheduled_attendees)
  WHERE array_length(scheduled_attendees, 1) > 0;
