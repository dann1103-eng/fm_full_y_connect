import { describe, it, expect } from 'vitest'
import { computeCambiosBalance } from './credits'

describe('computeCambiosBalance', () => {
  it('calcula remaining y total sumando créditos extra', () => {
    const b = computeCambiosBalance({ included: 5, used: 2, extraCredits: 3, pending: 1 })
    expect(b).toEqual({
      included: 5, used: 2, remaining_cycle: 3, extra_credits: 3, total_available: 6, pending: 1,
    })
  })
  it('no deja remaining negativo cuando se excede el cupo', () => {
    const b = computeCambiosBalance({ included: 4, used: 6, extraCredits: 0, pending: 0 })
    expect(b.remaining_cycle).toBe(0)
    expect(b.total_available).toBe(0)
  })
})
