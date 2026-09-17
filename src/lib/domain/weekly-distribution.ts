import { WEEKS_BASE } from '@/types/db'
import type { ContentType, WeekKey, WeeklyDistribution } from '@/types/db'

const WEEKS: ReadonlyArray<WeekKey> = WEEKS_BASE

/**
 * Rellena tipos que la distribución base no cubre, usando `ceil(limit/weeks.length)` como fallback.
 * Sólo considera los `pipelineTypes` (por ejemplo: se excluye 'reunion' si no está activa).
 * `weeks` por defecto son las 4 semanas de un ciclo mensual/quincenal; pasar `WEEKS_BIMONTHLY`
 * para ciclos bimestrales de 8 semanas.
 */
export function augmentDistribution(
  baseDist: WeeklyDistribution,
  pipelineTypes: ContentType[],
  limits: Record<ContentType, number>,
  weeks: ReadonlyArray<WeekKey> = WEEKS,
): WeeklyDistribution {
  const result: WeeklyDistribution = {}
  for (const w of weeks) {
    result[w] = {}
    for (const type of pipelineTypes) {
      const explicit = baseDist[w]?.[type]
      if (explicit !== undefined) {
        // Respect explicit 0 — means "no allocation this week for this type"
        if (explicit > 0) result[w]![type] = explicit
      } else {
        const fallback = Math.ceil(limits[type] / weeks.length)
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
 * (sólo los tipos que el admin ajustó). `weeks` define qué semanas se recorren.
 */
export function applyOverride(
  dist: WeeklyDistribution,
  override: WeeklyDistribution | null | undefined,
  weeks: ReadonlyArray<WeekKey> = WEEKS,
): WeeklyDistribution {
  if (!override) return dist
  const result: WeeklyDistribution = {}
  for (const w of weeks) {
    const base = dist[w] ?? {}
    const over = override[w] ?? {}
    result[w] = { ...base, ...over }
  }
  return result
}

/**
 * Distribuye el rollover equitativamente entre las semanas. El residuo se asigna
 * a las semanas tempranas (S1, S2, ...), de modo que 3 piezas → 1,1,1,0 y 5 → 2,1,1,1
 * (con las 4 semanas por defecto; con 8 semanas 5 → 1,1,1,1,1,0,0,0).
 */
export function addRollover(
  dist: WeeklyDistribution,
  rollover: Partial<Record<ContentType, number>>,
  weeks: ReadonlyArray<WeekKey> = WEEKS,
): WeeklyDistribution {
  const n = weeks.length
  const result: WeeklyDistribution = {}
  for (const w of weeks) result[w] = { ...(dist[w] ?? {}) }

  for (const [type, rawAmount] of Object.entries(rollover) as [ContentType, number][]) {
    const amount = Math.max(0, Math.floor(rawAmount ?? 0))
    if (amount === 0) continue
    const base = Math.floor(amount / n)
    const residue = amount % n
    for (let i = 0; i < n; i++) {
      const add = base + (i < residue ? 1 : 0)
      if (add === 0) continue
      const cur = result[weeks[i]]![type] ?? 0
      result[weeks[i]]![type] = cur + add
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
