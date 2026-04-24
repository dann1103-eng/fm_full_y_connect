import type { SupabaseClient } from '@supabase/supabase-js'
import type { Phase, ContentType, Priority, Database } from '@/types/db'

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
  'proceso_edicion',
  'proceso_diseno',
  'proceso_animacion',
  'cambios',
  'pausa',
  'revision_interna',
  'revision_diseno',
  'revision_cliente',
  'aprobado',
  'pendiente_publicar',
  'publicado_entregado',
]

export const PHASE_LABELS: Record<Phase, string> = {
  pendiente:           'Pendiente',
  proceso_edicion:     'Proceso de Edición',
  proceso_diseno:      'Proceso de Diseño',
  proceso_animacion:   'Proceso de Animación',
  cambios:             'Cambios',
  pausa:               'Pausa',
  revision_interna:    'Revisión Interna',
  revision_diseno:     'Revisión de Diseño',
  revision_cliente:    'Revisión Cliente',
  aprobado:            'Aprobado',
  pendiente_publicar:  'Pendiente de Publicar',
  publicado_entregado: 'Publicado / Entregado',
}

export type PhaseCategory = 'user_tracked' | 'passive_timer' | 'timestamp_only'

export const PHASE_CATEGORY: Record<Phase, PhaseCategory> = {
  pendiente:           'passive_timer',
  proceso_edicion:     'user_tracked',
  proceso_diseno:      'user_tracked',
  proceso_animacion:   'user_tracked',
  cambios:             'user_tracked',
  pausa:               'passive_timer',
  revision_interna:    'user_tracked',
  revision_diseno:     'user_tracked',
  revision_cliente:    'passive_timer',
  aprobado:            'timestamp_only',
  pendiente_publicar:  'timestamp_only',
  publicado_entregado: 'timestamp_only',
}

export const isUserTrackedPhase  = (p: Phase): boolean => PHASE_CATEGORY[p] === 'user_tracked'
export const isPassiveTimerPhase = (p: Phase): boolean => PHASE_CATEGORY[p] === 'passive_timer'
export const isTimestampOnlyPhase = (p: Phase): boolean => PHASE_CATEGORY[p] === 'timestamp_only'

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
  review_started_at: string | null
  priority: Priority
  estimated_time_minutes: number | null
  assigned_to: string[] | null
  assignees: { id: string; name: string; avatar_url: string | null }[]
  includes_story: boolean
  deadline: string | null
  starts_at: string | null
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

  // When entering revision_cliente, record the timestamp (passive timer reference)
  type RequirementUpdate = Database['public']['Tables']['requirements']['Update']
  const phaseUpdate: RequirementUpdate = { phase: toPhase }
  if (toPhase === 'revision_cliente') {
    phaseUpdate.review_started_at = new Date().toISOString()
  }

  const { error: updateError } = await supabase
    .from('requirements')
    .update(phaseUpdate)
    .eq('id', requirementId)

  if (updateError) return { error: updateError.message }

  // --- Cerrar el log previo (si existe y está abierto) con standby/worked ---
  const nowIso = new Date().toISOString()
  const { data: openLogs } = await supabase
    .from('requirement_phase_logs')
    .select('id, created_at, to_phase')
    .eq('requirement_id', requirementId)
    .is('ended_at', null)
    .order('created_at', { ascending: false })
    .limit(1)

  const openLog = openLogs?.[0]
  if (openLog) {
    const phaseStart = openLog.created_at
    // Solo fases user-tracked acumulan tiempo trabajado (otras no reciben time_entries).
    // Para passive_timer / timestamp_only, worked = 0 y standby = total.
    let workedSeconds = 0
    if (isUserTrackedPhase(openLog.to_phase as Phase)) {
      const { data: entries } = await supabase
        .from('time_entries')
        .select('duration_seconds, started_at, ended_at')
        .eq('requirement_id', requirementId)
        .eq('phase', openLog.to_phase)
        .gte('started_at', phaseStart)
      for (const e of entries ?? []) {
        if (e.duration_seconds != null) {
          workedSeconds += e.duration_seconds
        } else if (e.started_at) {
          // Timer aún corriendo — se cierra ahora
          const dur = Math.max(0, (new Date(nowIso).getTime() - new Date(e.started_at).getTime()) / 1000)
          workedSeconds += Math.floor(dur)
        }
      }
    }
    const totalSeconds = Math.max(
      0,
      Math.floor((new Date(nowIso).getTime() - new Date(phaseStart).getTime()) / 1000)
    )
    const standbySeconds = Math.max(0, totalSeconds - workedSeconds)

    await supabase
      .from('requirement_phase_logs')
      .update({
        ended_at: nowIso,
        worked_seconds: workedSeconds,
        standby_seconds: standbySeconds,
      })
      .eq('id', openLog.id)
  }

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

// ---------------------------------------------------------------------------
// Client-facing phase mapping
// ---------------------------------------------------------------------------

export type ClientPhase = 'diseno' | 'revision_cliente' | 'aprobado' | 'pendiente_publicar' | 'publicado'

export const CLIENT_PHASE_MAP: Record<Phase, ClientPhase | null> = {
  pendiente:           'diseno',
  proceso_edicion:     'diseno',
  proceso_diseno:      'diseno',
  proceso_animacion:   'diseno',
  cambios:             'diseno',
  pausa:               'diseno',
  revision_interna:    'diseno',
  revision_diseno:     'diseno',
  revision_cliente:    'revision_cliente',
  aprobado:            'aprobado',
  pendiente_publicar:  'pendiente_publicar',
  publicado_entregado: 'publicado',
}

export const CLIENT_PHASE_LABELS: Record<ClientPhase, string> = {
  diseno:             'En proceso',
  revision_cliente:   'Revisión de cliente',
  aprobado:           'Aprobado',
  pendiente_publicar: 'Pendiente de publicar',
  publicado:          'Publicado',
}

export const CLIENT_PHASE_ORDER: ClientPhase[] = [
  'diseno', 'revision_cliente', 'aprobado', 'pendiente_publicar', 'publicado',
]

export function clientPhaseOf(phase: Phase): ClientPhase | null {
  return CLIENT_PHASE_MAP[phase] ?? null
}

// ---------------------------------------------------------------------------

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
    .select('id, content_type, phase, title, review_started_at, assigned_to, includes_story, deadline')
    .eq('billing_cycle_id', previousCycleId)
    .eq('voided', false)
    .neq('phase', 'publicado_entregado')
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
        review_started_at: item.review_started_at ?? null,
        assigned_to: (item.assigned_to as string[] | null) ?? null,
        includes_story: item.includes_story ?? false,
        deadline: item.deadline ?? null,
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
