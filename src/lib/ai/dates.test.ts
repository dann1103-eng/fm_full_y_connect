import { describe, it, expect } from 'vitest'
import { isPlausibleDesiredDate } from './dates'

describe('isPlausibleDesiredDate', () => {
  it('acepta fecha YYYY-MM-DD', () => {
    expect(isPlausibleDesiredDate('2026-07-01')).toBe(true)
  })
  it('acepta datetime ISO con hora', () => {
    expect(isPlausibleDesiredDate('2026-07-01T15:30')).toBe(true)
  })
  it('rechaza basura o vacío', () => {
    expect(isPlausibleDesiredDate('mañana')).toBe(false)
    expect(isPlausibleDesiredDate('')).toBe(false)
    expect(isPlausibleDesiredDate('2026/07/01')).toBe(false)
  })
})
