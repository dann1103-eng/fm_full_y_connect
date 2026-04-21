import { describe, it, expect } from 'vitest'
import {
  parseDate,
  formatDate,
  addMonthsClamped,
  subtractDay,
  addDay,
  addDaysString,
  isBeforeDate,
  daysBetween,
  dayOfMonth,
} from './dates'

describe('parseDate / formatDate', () => {
  it('round-trips YYYY-MM-DD without timezone shift', () => {
    expect(formatDate(parseDate('2026-04-15'))).toBe('2026-04-15')
  })

  it('dayOfMonth returns the correct local day', () => {
    expect(dayOfMonth('2026-04-15')).toBe(15)
    expect(dayOfMonth('2026-01-31')).toBe(31)
  })
})

describe('addMonthsClamped', () => {
  it('adds one month normally', () => {
    expect(addMonthsClamped('2026-04-15', 1)).toBe('2026-05-15')
  })

  it('clamps January 31 + 1 month to February 28 (non-leap)', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28')
  })

  it('clamps January 31 + 1 month to February 29 (leap 2028)', () => {
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29')
  })

  it('crosses year boundary December → January', () => {
    expect(addMonthsClamped('2026-12-15', 1)).toBe('2027-01-15')
  })

  it('clamps March 31 + 1 month to April 30', () => {
    expect(addMonthsClamped('2026-03-31', 1)).toBe('2026-04-30')
  })
})

describe('addDay / subtractDay', () => {
  it('addDay crosses month boundary', () => {
    expect(addDay('2026-04-30')).toBe('2026-05-01')
  })

  it('subtractDay crosses month boundary', () => {
    expect(subtractDay('2026-05-01')).toBe('2026-04-30')
  })

  it('addDay crosses year boundary', () => {
    expect(addDay('2026-12-31')).toBe('2027-01-01')
  })
})

describe('addDaysString', () => {
  it('adds 13 days for biweekly period', () => {
    expect(addDaysString('2026-04-15', 13)).toBe('2026-04-28')
  })
})

describe('isBeforeDate / daysBetween', () => {
  it('isBeforeDate true when a is earlier', () => {
    expect(isBeforeDate('2026-04-15', '2026-04-16')).toBe(true)
    expect(isBeforeDate('2026-04-16', '2026-04-15')).toBe(false)
  })

  it('daysBetween counts calendar days', () => {
    expect(daysBetween('2026-04-15', '2026-05-14')).toBe(29)
    expect(daysBetween('2026-04-15', '2026-04-15')).toBe(0)
  })
})
