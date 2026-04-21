import type { PlanLimits, ContentType } from '@/types/db'

/** Tipos vendibles como contenido extra y su precio unitario (USD) */
export const EXTRA_CONTENT_PRICES: Partial<Record<ContentType, number>> = {
  video_corto: 25,
  reel: 25,
  short: 25,
  estatico: 15,
}

/** Human-readable label for each content type */
export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  historia: 'Historias',
  estatico: 'Estáticos',
  video_corto: 'Videos Cortos',
  reel: 'Video Largo',
  short: 'Shorts',
  produccion: 'Producciones',
  reunion: 'Reuniones',
  matriz_contenido: 'Matriz de contenido',
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
  'matriz_contenido',
]

/** Content types that never carry over between billing cycles */
export const NON_CARRYOVER_TYPES: ContentType[] = ['produccion', 'reunion', 'matriz_contenido']

/** Tipos de contenido "tippables" — el operador puede elegir uno u otro al registrar.
 *  En planes con `unified_content_limit`, estos tipos comparten un pool común. */
export const TIPPABLE_CONTENT_TYPES: ContentType[] = ['estatico', 'video_corto', 'reel', 'short']

/** Mapeo ContentType → llave del PlanLimits (`historia` → `historias`). */
export const CONTENT_TO_PLAN_KEY: Record<ContentType, keyof PlanLimits> = {
  historia: 'historias',
  estatico: 'estaticos',
  video_corto: 'videos_cortos',
  reel: 'reels',
  short: 'shorts',
  produccion: 'producciones',
  reunion: 'reuniones',
  matriz_contenido: 'matrices_contenido',
}

/** Convierte un rollover con llaves de PlanLimits a llaves de ContentType. */
export function rolloverToContentType(
  rollover: Partial<PlanLimits> | null | undefined,
): Partial<Record<ContentType, number>> {
  if (!rollover) return {}
  return {
    historia: rollover.historias ?? 0,
    estatico: rollover.estaticos ?? 0,
    video_corto: rollover.videos_cortos ?? 0,
    reel: rollover.reels ?? 0,
    short: rollover.shorts ?? 0,
    produccion: rollover.producciones ?? 0,
    reunion: rollover.reuniones ?? 0,
  }
}

/** Convert PlanLimits JSON to ContentType-keyed record */
export function limitsToRecord(limits: PlanLimits): Record<ContentType, number> {
  return {
    historia: limits.historias,
    estatico: limits.estaticos,
    video_corto: limits.videos_cortos,
    reel: limits.reels,
    short: limits.shorts,
    produccion: limits.producciones,
    reunion: limits.reuniones ?? 0,
    matriz_contenido: limits.matrices_contenido ?? 1,
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
    matriz_contenido: 0, // never carries over
  }

  return {
    historia: base.historia + (roll.historia ?? 0),
    estatico: base.estatico + (roll.estatico ?? 0),
    video_corto: base.video_corto + (roll.video_corto ?? 0),
    reel: base.reel + (roll.reel ?? 0),
    short: base.short + (roll.short ?? 0),
    produccion: base.produccion + (roll.produccion ?? 0),
    reunion: base.reunion + (roll.reunion ?? 0),
    matriz_contenido: base.matriz_contenido,
  }
}

/**
 * Ajusta los límites para planes con `unified_content_limit` (pool compartido).
 *
 * Toma los límites base (`effectiveLimits(...)`) y, si el snapshot incluye
 * `unified_content_limit`, redistribuye los tipos tippables:
 *   remainingPool = pool - sum(totals[tippable])
 *   limits[t] = remainingPool + totals[t]
 * Esto permite al operador elegir cualquier tipo hasta agotar el pool compartido,
 * sin romper el check `totals[t] >= limits[t]`.
 *
 * Planes sin `unified_content_limit` retornan los límites base sin modificar.
 */
export function applyUnifiedPool(
  base: Record<ContentType, number>,
  snapshot: PlanLimits,
  totals: Record<ContentType, number>,
): Record<ContentType, number> {
  const pool = snapshot.unified_content_limit
  if (pool == null) return base

  const consumed = TIPPABLE_CONTENT_TYPES.reduce((sum, t) => sum + (totals[t] ?? 0), 0)
  const remaining = Math.max(0, pool - consumed)

  const out = { ...base }
  for (const t of TIPPABLE_CONTENT_TYPES) {
    out[t] = remaining + (totals[t] ?? 0)
  }
  return out
}

/**
 * Consumo total del pool unificado (suma de tipos tippables).
 * Retorna null si el plan no usa `unified_content_limit`.
 */
export function unifiedPoolUsage(
  snapshot: PlanLimits,
  totals: Record<ContentType, number>,
): { used: number; limit: number } | null {
  const pool = snapshot.unified_content_limit
  if (pool == null) return null
  const used = TIPPABLE_CONTENT_TYPES.reduce((sum, t) => sum + (totals[t] ?? 0), 0)
  return { used, limit: pool }
}
