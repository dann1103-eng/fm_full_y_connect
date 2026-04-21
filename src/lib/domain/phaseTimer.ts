import type { Phase } from '@/types/db'

export type PhaseTimerColor = 'none' | 'green' | 'yellow' | 'orange' | 'red'

const HOUR = 3600_000
const PENDING_THRESHOLDS = { yellow: 12 * HOUR, orange: 24 * HOUR, red: 36 * HOUR }
const REVIEW_THRESHOLDS = { yellow: 1 * HOUR, orange: 2 * HOUR, red: 3 * HOUR }

export function getPhaseTimerColor(phase: Phase, elapsedMs: number): PhaseTimerColor {
  let t: { yellow: number; orange: number; red: number } | null = null
  if (phase === 'pendiente' || phase === 'revision_cliente') t = PENDING_THRESHOLDS
  else if (phase === 'revision_interna' || phase === 'revision_diseno') t = REVIEW_THRESHOLDS
  if (!t) return 'none'
  if (elapsedMs >= t.red) return 'red'
  if (elapsedMs >= t.orange) return 'orange'
  if (elapsedMs >= t.yellow) return 'yellow'
  return 'green'
}

export function phaseTimerBgClass(color: PhaseTimerColor): string {
  switch (color) {
    case 'green':  return 'bg-green-50 border-2 border-green-400'
    case 'yellow': return 'bg-yellow-50 border-2 border-yellow-500'
    case 'orange': return 'bg-orange-50 border-2 border-orange-500'
    case 'red':    return 'bg-red-50 border-2 border-red-500'
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
