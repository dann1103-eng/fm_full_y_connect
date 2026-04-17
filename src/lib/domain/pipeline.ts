import type { SupabaseClient } from '@supabase/supabase-js'
import type { Phase, ContentType, Database } from '@/types/db'

/** Tipos de contenido que participan en el pipeline (excluye produccion) */
export const PIPELINE_CONTENT_TYPES: ContentType[] = [
  'historia',
  'estatico',
  'video_corto',
  'reel',
  'short',
]

/** Fases en orden de flujo normal */
export const PHASES: Phase[] = [
  'pendiente',
  'en_produccion',
  'revision_interna',
  'revision_cliente',
  'aprobado',
  'publicado',
]

export const PHASE_LABELS: Record<Phase, string> = {
  pendiente: 'Pendiente',
  en_produccion: 'En Producción',
  revision_interna: 'Revisión Interna',
  revision_cliente: 'Revisión Cliente',
  aprobado: 'Aprobado',
  publicado: 'Publicado',
}

/** Shape plana que usan las vistas de pipeline */
export interface PipelineItem {
  id: string
  content_type: ContentType
  phase: Phase
  billing_cycle_id: string
  client_id: string
  client_name: string
  client_logo_url: string | null
  last_moved_at: string
  registered_at: string
  notes: string | null
}

/**
 * Mueve una pieza a una nueva fase.
 * - Valida que no sea tipo 'produccion'.
 * - Valida que toPhase sea un valor válido.
 * - Actualiza consumptions.phase.
 * - Inserta un log con from_phase, to_phase, moved_by, notes.
 * Retorna { error } si algo falla.
 */
export async function movePhase(
  supabase: SupabaseClient<Database>,
  params: {
    consumptionId: string
    currentPhase: Phase
    contentType: ContentType
    toPhase: Phase
    movedBy: string
    notes?: string
  }
): Promise<{ error: string | null }> {
  const { consumptionId, currentPhase, contentType, toPhase, movedBy, notes } = params

  if (contentType === 'produccion') {
    return { error: 'Las producciones no tienen pipeline de fases.' }
  }

  if (!PHASES.includes(toPhase)) {
    return { error: 'Fase no válida.' }
  }

  const { error: updateError } = await supabase
    .from('consumptions')
    .update({ phase: toPhase })
    .eq('id', consumptionId)

  if (updateError) return { error: updateError.message }

  const { error: logError } = await supabase
    .from('consumption_phase_logs')
    .insert({
      consumption_id: consumptionId,
      from_phase: currentPhase,
      to_phase: toPhase,
      moved_by: movedBy,
      notes: notes?.trim() || null,
    })

  if (logError) return { error: logError.message }

  return { error: null }
}

/**
 * Inserta el log inicial (from_phase = null, to_phase = 'pendiente').
 * Llamado inmediatamente después de insertar un consumo nuevo.
 */
export async function insertInitialPhaseLog(
  supabase: SupabaseClient<Database>,
  params: { consumptionId: string; movedBy: string }
): Promise<void> {
  await supabase.from('consumption_phase_logs').insert({
    consumption_id: params.consumptionId,
    from_phase: null,
    to_phase: 'pendiente',
    moved_by: params.movedBy,
  })
}
