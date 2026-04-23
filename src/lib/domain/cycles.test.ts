import { describe, it, expect } from 'vitest'
import {
  firstCycleDates,
  nextCycleDates,
  currentCycleDates,
  daysUntilEnd,
  isRenewalDue,
} from './cycles'

describe('firstCycleDates monthly', () => {
  it('April 15 → May 14 (caso original del bug)', () => {
    expect(firstCycleDates('2026-04-15')).toEqual({
      periodStart: '2026-04-15',
      periodEnd: '2026-05-14',
    })
  })

  it('March 19 → April 18 (caso original del bug)', () => {
    expect(firstCycleDates('2026-03-19')).toEqual({
      periodStart: '2026-03-19',
      periodEnd: '2026-04-18',
    })
  })

  it('January 31 → February 27 (clamp no-bisiesto)', () => {
    expect(firstCycleDates('2026-01-31')).toEqual({
      periodStart: '2026-01-31',
      periodEnd: '2026-02-27',
    })
  })

  it('January 31 → February 28 (clamp año bisiesto 2028)', () => {
    expect(firstCycleDates('2028-01-31')).toEqual({
      periodStart: '2028-01-31',
      periodEnd: '2028-02-28',
    })
  })

  it('December 15 → January 14 del siguiente año', () => {
    expect(firstCycleDates('2026-12-15')).toEqual({
      periodStart: '2026-12-15',
      periodEnd: '2027-01-14',
    })
  })

  it('periodStart NUNCA se corre un día (regresión timezone)', () => {
    // Este test fallaría con el bug de TZ: new Date("2026-04-15") en UTC-6 → Apr 14.
    expect(firstCycleDates('2026-04-15').periodStart).toBe('2026-04-15')
  })
})

describe('firstCycleDates biweekly', () => {
  it('April 15 → April 28 (14 días inclusivos)', () => {
    expect(firstCycleDates('2026-04-15', { billingPeriod: 'biweekly' })).toEqual({
      periodStart: '2026-04-15',
      periodEnd: '2026-04-28',
    })
  })
})

describe('nextCycleDates', () => {
  it('contiguo al ciclo anterior sin gap ni solapamiento', () => {
    expect(nextCycleDates('2026-05-14')).toEqual({
      periodStart: '2026-05-15',
      periodEnd: '2026-06-14',
    })
  })

  it('cruza el año: 31 dic → 1 enero', () => {
    expect(nextCycleDates('2026-12-31')).toEqual({
      periodStart: '2027-01-01',
      periodEnd: '2027-01-31',
    })
  })

  it('biweekly: suma 14 días al día después del periodEnd anterior', () => {
    expect(nextCycleDates('2026-04-28', { billingPeriod: 'biweekly' })).toEqual({
      periodStart: '2026-04-29',
      periodEnd: '2026-05-12',
    })
  })
})

describe('currentCycleDates (default del formulario)', () => {
  it('billingDay = 15 en ref 2026-04-17 → start 2026-04-15 end 2026-05-14', () => {
    expect(currentCycleDates(15, '2026-04-17')).toEqual({
      periodStart: '2026-04-15',
      periodEnd: '2026-05-14',
    })
  })

  it('billingDay = 15 en ref 2026-04-10 → start del mes anterior', () => {
    expect(currentCycleDates(15, '2026-04-10')).toEqual({
      periodStart: '2026-03-15',
      periodEnd: '2026-04-14',
    })
  })

  it('billingDay = 31 en febrero se clampea al último día de enero', () => {
    expect(currentCycleDates(31, '2026-02-10')).toEqual({
      periodStart: '2026-01-31',
      periodEnd: '2026-02-27',
    })
  })
})

describe('daysUntilEnd / isRenewalDue', () => {
  it('daysUntilEnd es positivo cuando el ciclo no ha vencido', () => {
    expect(daysUntilEnd('2026-04-25', '2026-04-20')).toBe(5)
  })

  it('daysUntilEnd es negativo cuando ya venció', () => {
    expect(daysUntilEnd('2026-04-15', '2026-04-20')).toBe(-5)
  })

  it('isRenewalDue: true si faltan ≤ 3 días', () => {
    expect(isRenewalDue('2026-04-23', '2026-04-20')).toBe(true)
    expect(isRenewalDue('2026-04-24', '2026-04-20')).toBe(false)
  })

  it('isRenewalDue: true si ya venció', () => {
    expect(isRenewalDue('2026-04-15', '2026-04-20')).toBe(true)
  })
})
