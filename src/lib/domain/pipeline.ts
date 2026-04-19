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
  carried_over: boolean
  title: string
  cambios_count: number
  max_cambios: number   // client's limit, fetched from clients table
}

/**
 * Mueve un requerimiento a una nueva fase.
 * - Valida que no sea tipo 'produccion'.
 * - Valida que toPhase sea un valor válido.
 * - Actualiza requirements.phase.
 * - Inserta un log con from_phase, to_phase, moved_by, notes.
 * Retorna { error } si algo falla.
 */
export async function movePhase(
  supabase: SupabaseClient<Database>,
  params: {
    requirementId: string
    currentPhase: Phase
    contentType: ContentType
    toPhase: Phase
    movedBy: string
    notes?: string
  }
): Promise<{ error: string | null }> {
  const { requirementId, currentPhase, contentType, toPhase, movedBy, notes } = params

  if (contentType === 'produccion') {
    return { error: 'Las producciones no tienen pipeline de fases.' }
  }

  if (!PHASES.includes(toPhase)) {
    return { error: 'Fase no válida.' }
  }

  const { error: updateError } = await supabase
    .from('requirements')
    .update({ phase: toPhase })
    .eq('id', requirementId)

  if (updateError) return { error: updateError.message }

  const { error: logError } = await supabase
    .from('requirement_phase_logs')
    .insert({
      requirement_id: requirementId,
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
 * Llamado inmediatamente después de insertar un requerimiento nuevo.
 */
export async function insertInitialPhaseLog(
  supabase: SupabaseClient<Database>,
  params: { requirementId: string; movedBy: string }
): Promise<void> {
  await supabase.from('requirement_phase_logs').insert({
    requirement_id: params.requirementId,
    from_phase: null,
    to_phase: 'pendiente',
    moved_by: params.movedBy,
  })
}

/**
 * Traslada automáticamente los requerimientos abiertos del ciclo anterior al nuevo ciclo.
 * - Solo tipos en PIPELINE_CONTENT_TYPES (excluye 'produccion')
 * - Solo no anulados y en fase distinta a 'publicado'
 * - Los requerimientos trasladados tienen carried_over = true (no descuentan del nuevo límite)
 * - Se copian todos los logs históricos + se agrega un log de migración
 */
export async function migrateOpenPipelineItems(
  supabase: SupabaseClient<Database>,
  params: {
    previousCycleId: string
    newCycleId: string
    movedBy: string
  }
): Promise<void> {
  const { previousCycleId, newCycleId, movedBy } = params

  // 1. Obtener requerimientos abiertos del ciclo anterior
  const { data: openItems } = await supabase
    .from('requirements')
    .select('id, content_type, phase, title')
    .eq('billing_cycle_id', previousCycleId)
    .eq('voided', false)
    .neq('phase', 'publicado')
    .in('content_type', PIPELINE_CONTENT_TYPES)

  if (!openItems || openItems.length === 0) return

  for (const item of openItems) {
    // 2. Crear nuevo requerimiento en el nuevo ciclo
    const { data: newRequirement, error: insertError } = await supabase
      .from('requirements')
      .insert({
        billing_cycle_id: newCycleId,
        content_type: item.content_type,
        phase: item.phase as Phase,
        carried_over: true,
        registered_by_user_id: movedBy,
        over_limit: false,
        voided: false,
        title: item.title ?? '',
      })
      .select('id')
      .single()

    if (insertError || !newRequirement) {
      console.error('migrateOpenPipelineItems: falló al insertar requerimiento trasladado', insertError)
      continue
    }

    // 3. Copiar logs históricos del requerimiento original
    const { data: oldLogs } = await supabase
      .from('requirement_phase_logs')
      .select('*')
      .eq('requirement_id', item.id)
      .order('created_at', { ascending: true })

    // Omitir deliberadamente log.id para que Supabase genere un nuevo UUID por cada copia
    for (const log of oldLogs ?? []) {
      await supabase.from('requirement_phase_logs').insert({
        requirement_id: newRequirement.id,
        from_phase: log.from_phase as Phase | null,
        to_phase: log.to_phase as Phase,
        moved_by: log.moved_by,
        notes: log.notes,
        created_at: log.created_at,
      })
    }

    // 4. Agregar log de migración
    await supabase.from('requirement_phase_logs').insert({
      requirement_id: newRequirement.id,
      from_phase: null,
      to_phase: item.phase as Phase,
      moved_by: movedBy,
      notes: 'Trasladado del ciclo anterior',
    })
  }
}
