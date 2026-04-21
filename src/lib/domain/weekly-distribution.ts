import type { ContentType, WeekKey, WeeklyDistribution } from '@/types/db'

const WEEKS: WeekKey[] = ['S1', 'S2', 'S3', 'S4']

/**
 * Rellena tipos que la distribución base no cubre, usando `ceil(limit/4)` como fallback.
 * Sólo considera los `pipelineTypes` (por ejemplo: se excluye 'reunion' si no está activa).
 */
export function augmentDistribution(
  baseDist: WeeklyDistribution,
  pipelineTypes: ContentType[],
  limits: Record<ContentType, number>,
): WeeklyDistribution {
  const result: WeeklyDistribution = {}
  for (const w of WEEKS) {
    result[w] = {}
    for (const type of pipelineTypes) {
      const explicit = baseDist[w]?.[type]
      if (explicit !== undefined) {
        // Respect explicit 0 — means "no allocation this week for this type"
        if (explicit > 0) result[w]![type] = explicit
      } else {
        const fallback = Math.ceil(limits[type] / 4)
        if (fallback > 0) result[w]![type] = fallback
      }
    }
  }
  return result
}

/**
 * Reemplaza el budget semanal de los tipos presentes en `override`. Tipos ausentes
 * en el override mantienen sus valores originales. Null/undefined = no override.
 *
 * Formato del override: mismo que `WeeklyDistribution` pero puede ser parcial
 * (sólo los tipos que el admin ajustó).
 */
export function applyOverride(
  dist: WeeklyDistribution,
  override: WeeklyDistribution | null | undefined,
): WeeklyDistribution {
  if (!override) return dist
  const result: WeeklyDistribution = {}
  for (const w of WEEKS) {
    const base = dist[w] ?? {}
    const over = override[w] ?? {}
    result[w] = { ...base, ...over }
  }
  return result
}

/**
 * Distribuye el rollover equitativamente entre las 4 semanas. El residuo se asigna
 * a las semanas tempranas (S1, S2, ...), de modo que 3 piezas → 1,1,1,0 y 5 → 2,1,1,1.
 */
export function addRollover(
  dist: WeeklyDistribution,
  rollover: Partial<Record<ContentType, number>>,
): WeeklyDistribution {
  const result: WeeklyDistribution = {}
  for (const w of WEEKS) result[w] = { ...(dist[w] ?? {}) }

  for (const [type, rawAmount] of Object.entries(rollover) as [ContentType, number][]) {
    const amount = Math.max(0, Math.floor(rawAmount ?? 0))
    if (amount === 0) continue
    const base = Math.floor(amount / 4)
    const residue = amount % 4
    for (let i = 0; i < 4; i++) {
      const add = base + (i < residue ? 1 : 0)
      if (add === 0) continue
      const cur = result[WEEKS[i]]![type] ?? 0
      result[WEEKS[i]]![type] = cur + add
    }
  }

  return result
}

/**
 * Genera un override para prorratear un delta entre las 4 semanas (patrón 2,1,1,1 / 1,1,1,1).
 * El residuo entra en las semanas tempranas (mismo reparto que `addRollover`).
 */
export function buildProrateOverride(
  baseDist: WeeklyDistribution,
  deltaByType: Partial<Record<ContentType, number>>,
): WeeklyDistribution {
  const result: WeeklyDistribution = {}
  for (const w of WEEKS) result[w] = { ...(baseDist[w] ?? {}) }

  for (const [type, delta] of Object.entries(deltaByType) as [ContentType, number][]) {
    if (!delta) continue
    // Compute target total and distribute evenly — handles negative deltas correctly
    const currentTotal = WEEKS.reduce((sum, w) => sum + (result[w]![type] ?? 0), 0)
    const targetTotal = Math.max(0, currentTotal + delta)
    const base = Math.floor(targetTotal / 4)
    const residue = targetTotal % 4
    for (let i = 0; i < 4; i++) {
      result[WEEKS[i]]![type] = base + (i < residue ? 1 : 0)
    }
  }

  return result
}

/**
 * Genera un override para acumular un delta en una sola semana (por tipo).
 */
export function buildAccumulateOverride(
  baseDist: WeeklyDistribution,
  deltaByType: Partial<Record<ContentType, number>>,
  targetWeek: WeekKey,
): WeeklyDistribution {
  const result: WeeklyDistribution = {}
  for (const w of WEEKS) result[w] = { ...(baseDist[w] ?? {}) }

  for (const [type, delta] of Object.entries(deltaByType) as [ContentType, number][]) {
    if (!delta) continue
    const cur = result[targetWeek]![type] ?? 0
    result[targetWeek]![type] = Math.max(0, cur + delta)
  }

  return result
}
