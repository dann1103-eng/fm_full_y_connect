import { describe, it, expect } from 'vitest'
import { computeTargetPeriods, matrixTitleFor, periodLabel, resolveMatrixLimits } from './matrix'
import type { BillingCycle, Plan, Requirement } from '@/types/db'

describe('computeTargetPeriods', () => {
  it('con ciclo vigente mensual encadena 4 períodos', () => {
    const r = computeTargetPeriods({
      currentCycle: { period_start: '2026-10-15', period_end: '2026-11-14' },
      billingDay: 15, billingPeriod: 'monthly', today: '2026-10-20',
    })
    expect(r).toHaveLength(4)
    expect(r[0]).toMatchObject({ periodStart: '2026-10-15', periodEnd: '2026-11-14', isCurrent: true })
    expect(r[1]).toMatchObject({ periodStart: '2026-11-15', periodEnd: '2026-12-14', isCurrent: false })
    expect(r[3].periodStart).toBe('2027-01-15')
  })

  it('ajusta a fin de mes (31 ene → 27 feb → 27 mar)', () => {
    const r = computeTargetPeriods({
      currentCycle: { period_start: '2026-01-31', period_end: '2026-02-27' },
      billingDay: 31, billingPeriod: 'monthly', today: '2026-02-01', count: 2,
    })
    expect(r[1]).toMatchObject({ periodStart: '2026-02-28', periodEnd: '2026-03-27' })
  })

  it('quincenal: 14 días por período', () => {
    const r = computeTargetPeriods({
      currentCycle: { period_start: '2026-09-01', period_end: '2026-09-14' },
      billingDay: 1, billingPeriod: 'biweekly', today: '2026-09-05', count: 2,
    })
    expect(r[1]).toMatchObject({ periodStart: '2026-09-15', periodEnd: '2026-09-28' })
  })

  it('bimestral: 60 días por período', () => {
    const r = computeTargetPeriods({
      currentCycle: { period_start: '2026-09-01', period_end: '2026-10-30' },
      billingDay: 1, billingPeriod: 'bimonthly', today: '2026-09-05', count: 2,
    })
    expect(r[1]).toMatchObject({ periodStart: '2026-10-31', periodEnd: '2026-12-29' })
  })

  it('sin ciclo vigente parte del billing_day', () => {
    const r = computeTargetPeriods({ currentCycle: null, billingDay: 15, billingPeriod: 'monthly', today: '2026-09-16', count: 2 })
    expect(r[0]).toMatchObject({ periodStart: '2026-09-15', periodEnd: '2026-10-14', isCurrent: true })
    expect(r[1].periodStart).toBe('2026-10-15')
  })
})

describe('periodLabel / matrixTitleFor', () => {
  it('etiqueta corta con año', () => {
    expect(periodLabel('2026-10-15', '2026-11-14')).toBe('15 oct al 14 nov 2026')
  })
  it('título usa el mes dominante', () => {
    expect(matrixTitleFor('2026-10-15', '2026-11-14')).toBe('Matriz octubre 2026')
    expect(matrixTitleFor('2026-10-20', '2026-11-19')).toBe('Matriz noviembre 2026')
  })
})

const PLAN_LIMITS = { historias: 4, estaticos: 4, videos_cortos: 2, reels: 2, shorts: 4, producciones: 1, reuniones: 1, matrices_contenido: 1 }
const plan = { id: 'p1', limits_json: PLAN_LIMITS, unified_content_limit: null } as unknown as Plan
const poolPlan = { id: 'p2', limits_json: { ...PLAN_LIMITS, historia: 0, estaticos: 0, videos_cortos: 0, reels: 0, shorts: 0 }, unified_content_limit: 10 } as unknown as Plan

function cycleWith(extra: Partial<BillingCycle>): BillingCycle {
  return {
    id: 'c1', limits_snapshot_json: PLAN_LIMITS, rollover_from_previous_json: null,
    content_limits_override_json: null, ...extra,
  } as unknown as BillingCycle
}
function req(content_type: Requirement['content_type'], extra: Partial<Requirement> = {}): Requirement {
  return { id: Math.random().toString(), content_type, voided: false, carried_over: false, includes_story: false, consumption_overrides_json: null, ...extra } as unknown as Requirement
}

describe('resolveMatrixLimits', () => {
  it('con ciclo: snapshot + rollover + override, totales del ciclo', () => {
    const cycle = cycleWith({ rollover_from_previous_json: { estaticos: 2 }, content_limits_override_json: { reel: 5 } })
    const r = resolveMatrixLimits({ cycle, plan, cycleRequirements: [req('estatico'), req('estatico', { voided: true })], credits: { short: 1 } })
    expect(r.estimated).toBe(false)
    expect(r.limits.estatico).toBe(6)
    expect(r.limits.reel).toBe(5)
    expect(r.cycleTotals.estatico).toBe(1)
    expect(r.credits.short).toBe(1)
    expect(r.unifiedPool).toBeNull()
  })

  it('sin ciclo: límites del plan actual, estimado', () => {
    const r = resolveMatrixLimits({ cycle: null, plan, cycleRequirements: [], credits: {} })
    expect(r.estimated).toBe(true)
    expect(r.limits.estatico).toBe(4)
    expect(r.cycleTotals.estatico).toBe(0)
  })

  it('pool unificado: lo toma del snapshot o del plan', () => {
    const withCycle = resolveMatrixLimits({ cycle: cycleWith({ limits_snapshot_json: { ...PLAN_LIMITS, unified_content_limit: 12 } }), plan, cycleRequirements: [], credits: {} })
    expect(withCycle.unifiedPool).toBe(12)
    const noCycle = resolveMatrixLimits({ cycle: null, plan: poolPlan, cycleRequirements: [], credits: {} })
    expect(noCycle.unifiedPool).toBe(10)
    expect(noCycle.limits.estatico).toBe(0)
  })
})
