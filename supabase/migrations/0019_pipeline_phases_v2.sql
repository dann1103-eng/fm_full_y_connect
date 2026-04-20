-- Fase G: Reestructura de fases del pipeline (6 → 12)
-- Mapear fases antiguas a las nuevas equivalentes
UPDATE requirements SET phase = 'proceso_edicion'   WHERE phase = 'en_produccion';
UPDATE requirements SET phase = 'publicado_entregado' WHERE phase = 'publicado';

UPDATE requirement_phase_logs SET to_phase = 'proceso_edicion'   WHERE to_phase = 'en_produccion';
UPDATE requirement_phase_logs SET to_phase = 'publicado_entregado' WHERE to_phase = 'publicado';
UPDATE requirement_phase_logs SET from_phase = 'proceso_edicion'   WHERE from_phase = 'en_produccion';
UPDATE requirement_phase_logs SET from_phase = 'publicado_entregado' WHERE from_phase = 'publicado';

-- Actualizar CHECK constraints (requirements.phase)
ALTER TABLE requirements DROP CONSTRAINT IF EXISTS requirements_phase_check;
ALTER TABLE requirements ADD CONSTRAINT requirements_phase_check CHECK (
  phase IN (
    'pendiente','proceso_edicion','proceso_diseno','proceso_animacion','cambios',
    'pausa','revision_interna','revision_diseno','revision_cliente',
    'aprobado','pendiente_publicar','publicado_entregado'
  )
);

-- Actualizar CHECK constraints (requirement_phase_logs.to_phase)
ALTER TABLE requirement_phase_logs DROP CONSTRAINT IF EXISTS requirement_phase_logs_to_phase_check;
ALTER TABLE requirement_phase_logs ADD CONSTRAINT requirement_phase_logs_to_phase_check CHECK (
  to_phase IN (
    'pendiente','proceso_edicion','proceso_diseno','proceso_animacion','cambios',
    'pausa','revision_interna','revision_diseno','revision_cliente',
    'aprobado','pendiente_publicar','publicado_entregado'
  )
);

-- Actualizar CHECK constraints (requirement_phase_logs.from_phase) si existe
ALTER TABLE requirement_phase_logs DROP CONSTRAINT IF EXISTS requirement_phase_logs_from_phase_check;
ALTER TABLE requirement_phase_logs ADD CONSTRAINT requirement_phase_logs_from_phase_check CHECK (
  from_phase IS NULL OR from_phase IN (
    'pendiente','proceso_edicion','proceso_diseno','proceso_animacion','cambios',
    'pausa','revision_interna','revision_diseno','revision_cliente',
    'aprobado','pendiente_publicar','publicado_entregado'
  )
);
