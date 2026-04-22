import type { Phase } from '@/types/db'

export type PhaseTimerColor = 'none' | 'green' | 'yellow' | 'orange' | 'red'

const HOUR = 3600_000
const PENDING_THRESHOLDS  = { yellow:  12 * HOUR, orange: 24 * HOUR, red: 36 * HOUR }
const REVIEW_THRESHOLDS   = { yellow:   1 * HOUR, orange:  2 * HOUR, red:  3 * HOUR }
const PROCESS_THRESHOLDS  = { yellow:   4 * HOUR, orange:  6 * HOUR, red:  8 * HOUR }

export function getPhaseTimerColor(phase: Phase, elapsedMs: number): PhaseTimerColor {
  // Cambios: siempre rojo
  if (phase === 'cambios') return 'red'

  let t: { yellow: number; orange: number; red: number } | null = null
  if (phase === 'pendiente' || phase === 'revision_cliente')           t = PENDING_THRESHOLDS
  else if (phase === 'revision_interna' || phase === 'revision_diseno') t = REVIEW_THRESHOLDS
  else if (
    phase === 'proceso_edicion' ||
    phase === 'proceso_diseno'  ||
    phase === 'proceso_animacion'
  ) t = PROCESS_THRESHOLDS

  if (!t) return 'none'
  if (elapsedMs >= t.red)    return 'red'
  if (elapsedMs >= t.orange) return 'orange'
  if (elapsedMs >= t.yellow) return 'yellow'
  return 'green'
}

export function phaseTimerBgClass(color: PhaseTimerColor): string {
  switch (color) {
    case 'green':  return 'bg-green-50 dark:bg-green-950/40 border-2 border-green-400 dark:border-green-500/60'
    case 'yellow': return 'bg-yellow-50 dark:bg-yellow-950/40 border-2 border-yellow-500 dark:border-yellow-500/60'
    case 'orange': return 'bg-orange-50 dark:bg-orange-950/40 border-2 border-orange-500 dark:border-orange-500/60'
    case 'red':    return 'bg-red-50 dark:bg-red-950/40 border-2 border-red-500 dark:border-red-500/60'
    default:       return ''
  }
}

export function phaseTimerLabel(color: PhaseTimerColor): string {
  switch (color) {
    case 'green':  return 'A tiempo'
    case 'yellow': return 'Atención'
    case 'orange': return 'Retrasado'
    case 'red':    return 'Crítico'
    default:       return ''
  }
}
