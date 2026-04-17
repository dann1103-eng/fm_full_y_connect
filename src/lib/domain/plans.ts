import type { PlanLimits, ContentType } from '@/types/db'

/** Human-readable label for each content type */
export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  historia: 'Historias',
  estatico: 'Estáticos',
  video_corto: 'Videos Cortos',
  reel: 'Video Largo',
  short: 'Shorts',
  produccion: 'Producciones',
  reunion: 'Reuniones',
}

/** Ordered list for display */
export const CONTENT_TYPES: ContentType[] = [
  'historia',
  'estatico',
  'video_corto',
  'reel',
  'short',
  'produccion',
  'reunion',
]

/** Convert PlanLimits JSON to ContentType-keyed record */
export function limitsToRecord(limits: PlanLimits): Record<ContentType, number> {
  return {
    historia: limits.historias,
    estatico: limits.estaticos,
    video_corto: limits.videos_cortos,
    reel: limits.reels,
    short: limits.shorts,
    produccion: limits.producciones,
    reunion: limits.reuniones ?? 0,  // ?? 0: ciclos antiguos sin este campo devuelven 0
  }
}

/** Compute effective limits = snapshot + rollover */
export function effectiveLimits(
  snapshot: PlanLimits,
  rollover: Partial<PlanLimits> | null
): Record<ContentType, number> {
  const base = limitsToRecord(snapshot)
  if (!rollover) return base

  const roll: Partial<Record<ContentType, number>> = {
    historia: rollover.historias ?? 0,
    estatico: rollover.estaticos ?? 0,
    video_corto: rollover.videos_cortos ?? 0,
    reel: rollover.reels ?? 0,
    short: rollover.shorts ?? 0,
    produccion: rollover.producciones ?? 0,
    reunion: rollover.reuniones ?? 0,
  }

  return {
    historia: base.historia + (roll.historia ?? 0),
    estatico: base.estatico + (roll.estatico ?? 0),
    video_corto: base.video_corto + (roll.video_corto ?? 0),
    reel: base.reel + (roll.reel ?? 0),
    short: base.short + (roll.short ?? 0),
    produccion: base.produccion + (roll.produccion ?? 0),
    reunion: base.reunion + (roll.reunion ?? 0),
  }
}
