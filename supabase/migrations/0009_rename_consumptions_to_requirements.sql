-- ============================================================
-- FM CRM — Migration 0009: Renombrar consumptions → requirements
-- ============================================================

-- 1. Renombrar tablas
ALTER TABLE public.consumptions RENAME TO requirements;
ALTER TABLE public.consumption_phase_logs RENAME TO requirement_phase_logs;

-- 2. Renombrar columna consumption_id → requirement_id en requirement_phase_logs
ALTER TABLE public.requirement_phase_logs RENAME COLUMN consumption_id TO requirement_id;

-- 3. Renombrar índices
ALTER INDEX consumptions_cycle_id_idx RENAME TO requirements_cycle_id_idx;
ALTER INDEX consumptions_type_idx RENAME TO requirements_type_idx;
ALTER INDEX phase_logs_consumption_id_idx RENAME TO phase_logs_requirement_id_idx;

-- 4. Renombrar CHECK constraint (tabla ahora es requirements)
ALTER TABLE public.requirements
  RENAME CONSTRAINT consumptions_content_type_check TO requirements_content_type_check;

-- 5. Renombrar FK constraints
ALTER TABLE public.requirements
  RENAME CONSTRAINT consumptions_billing_cycle_id_fkey TO requirements_billing_cycle_id_fkey;

ALTER TABLE public.requirement_phase_logs
  RENAME CONSTRAINT consumption_phase_logs_consumption_id_fkey TO requirement_phase_logs_requirement_id_fkey;

-- 6. Actualizar políticas RLS en requirements
DROP POLICY "Agency users can view consumptions" ON public.requirements;
DROP POLICY "Agency users can register consumptions" ON public.requirements;
DROP POLICY "Agency users can void consumptions" ON public.requirements;

CREATE POLICY "Agency users can view requirements"
  ON public.requirements FOR SELECT
  USING (public.is_agency_user());

CREATE POLICY "Agency users can register requirements"
  ON public.requirements FOR INSERT
  WITH CHECK (public.is_agency_user());

CREATE POLICY "Agency users can void requirements"
  ON public.requirements FOR UPDATE
  USING (public.is_agency_user());

-- 7. Actualizar políticas RLS en requirement_phase_logs
DROP POLICY "Agency users can view phase logs" ON public.requirement_phase_logs;
DROP POLICY "Agency users can insert phase logs" ON public.requirement_phase_logs;

CREATE POLICY "Agency users can view requirement phase logs"
  ON public.requirement_phase_logs FOR SELECT
  USING (public.is_agency_user());

CREATE POLICY "Agency users can insert requirement phase logs"
  ON public.requirement_phase_logs FOR INSERT
  WITH CHECK (public.is_agency_user());
