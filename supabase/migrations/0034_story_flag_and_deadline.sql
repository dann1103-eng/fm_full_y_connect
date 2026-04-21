-- Adds two new fields to requirements:
--   includes_story: boolean flag — when true, this requirement counts as +1
--                   towards the historia totals (derived story). Default false
--                   to avoid retroactively counting legacy rows.
--   deadline:       optional delivery date. Drives the Kanban card calendar
--                   icon color semaphore (green/yellow/amber/red) and the
--                   "Vencido" bubble for overdue items in non-terminal phases.

ALTER TABLE public.requirements
  ADD COLUMN includes_story boolean NOT NULL DEFAULT false;

ALTER TABLE public.requirements
  ADD COLUMN deadline date NULL;

CREATE INDEX IF NOT EXISTS idx_requirements_deadline
  ON public.requirements(deadline)
  WHERE deadline IS NOT NULL;
