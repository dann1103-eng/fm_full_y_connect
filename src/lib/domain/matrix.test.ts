import { describe, it, expect } from 'vitest'
import { computeTargetPeriods, matrixTitleFor, periodLabel } from './matrix'

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
