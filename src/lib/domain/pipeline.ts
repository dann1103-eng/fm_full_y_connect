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

/** Fases en las que NO tiene sentido pedir un cambio (contenido ya cerrado). */
const CHANGE_BLOCKED_PHASES: Phase[] = ['aprobado', 'pendiente_publicar', 'publicado_entregado']

/** True si en esta fase interna el cliente todavía puede pedir un cambio. */
export function canRequestChangeForPhase(phase: Phase): boolean {
  return !CHANGE_BLOCKED_PHASES.includes(phase)
}

// ---------------------------------------------------------------------------

/**
 * Traslada los requerimientos abiertos del ciclo anterior al nuevo ciclo.
 * - Solo tipos en PIPELINE_CONTENT_TYPES (excluye 'produccion')
 * - Solo no anulados y en fase distinta a 'publicado_entregado'
 * - Marca carried_over = true (no descuentan del nuevo límite)
 *
 * IMPORTANTE: Esta función MUEVE el requerimiento (UPDATE billing_cycle_id),
 * NO crea una copia. Esto preserva todos los datos relacionados:
 * - requirement_messages (chat)
 * - requirement_cambio_logs
 * - review_assets / review_versions / review_pins / review_comments
 * - time_entries
 * - requirement_phase_logs (toda la historia de fases — no se altera)
 *
 * NO inserta un phase_log de auditoría: hacerlo rompe el cálculo de
 * "tiempo en fase" porque last_moved_at usa el log más reciente. La
 * auditoría queda implícita en `carried_over=true` y en el cambio de
 * `billing_cycle_id`.
 */
export async function migrateOpenPipelineItems(
  supabase: SupabaseClient<Database>,
  params: {
    previousCycleId: string
    newCycleId: string
    movedBy: string
  }
): Promise<void> {
  // movedBy se conserva en la firma para compat — ya no se usa porque no
  // insertamos un log de auditoría. Lo referenciamos para evitar el lint.
  void params.movedBy

  const { previousCycleId, newCycleId } = params

  const { data: openItems } = await supabase
    .from('requirements')
    .select('id')
    .eq('billing_cycle_id', previousCycleId)
    .eq('voided', false)
    .neq('phase', 'publicado_entregado')
    .in('content_type', PIPELINE_CONTENT_TYPES)

  if (!openItems || openItems.length === 0) return

  for (const item of openItems) {
    const { error: updErr } = await supabase
      .from('requirements')
      .update({ billing_cycle_id: newCycleId, carried_over: true })
      .eq('id', item.id)

    if (updErr) {
      console.error('migrateOpenPipelineItems: falló al mover requerimiento', updErr)
      continue
    }
  }
}
