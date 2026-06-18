import { describe, it, expect } from 'vitest'
import { applyExtraCreditsToAvailability } from './requirementRequestHelpers'
import type { RequestEligibilityResult } from './requirementRequestHelpers'

describe('applyExtraCreditsToAvailability', () => {
  it('suma créditos extra al available por tipo', () => {
    const types: RequestEligibilityResult['available_content_types'] = [
      { type: 'short', label: 'Short', used: 2, limit: 2, available: 0, allows_extra_story: true },
    ]
    const out = applyExtraCreditsToAvailability(types, { short: 3 })
    expect(out[0].available).toBe(3)
  })
  it('no altera tipos sin crédito', () => {
    const types: RequestEligibilityResult['available_content_types'] = [
      { type: 'reel', label: 'Reel', used: 1, limit: 4, available: 3, allows_extra_story: true },
    ]
    const out = applyExtraCreditsToAvailability(types, {})
    expect(out[0].available).toBe(3)
  })
})
