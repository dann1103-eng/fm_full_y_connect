import { describe, it, expect } from 'vitest'
import {
  computeCambiosBalance,
  creditKindFromExtras,
  creditKindsForContent,
  evaluateRegistration,
  type RegistrationInput,
} from './credits'

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

describe('creditKindFromExtras', () => {
  it('mapea cada paquete extra a su tipo de crédito', () => {
    expect(creditKindFromExtras({ kind: 'cambios', qty: 5 })).toBe('cambios')
    expect(creditKindFromExtras({ kind: 'content', content_type: 'reel', qty: 2 })).toBe('content_reel')
    expect(creditKindFromExtras({ kind: 'content_pool', qty: 10 })).toBe('content_pool')
  })
  it('rechaza lo que no se puede vender como crédito', () => {
    expect(creditKindFromExtras({ kind: 'content', content_type: 'historia', qty: 1 })).toBeNull()
    expect(creditKindFromExtras({ kind: 'content', qty: 1 })).toBeNull()
  })
})

describe('creditKindsForContent — orden de uso', () => {
  it('primero el crédito del tipo y luego el paquete on-demand', () => {
    expect(creditKindsForContent('reel')).toEqual(['content_reel', 'content_pool'])
    expect(creditKindsForContent('estatico')).toEqual(['content_estatico', 'content_pool'])
  })
  it('historias, producciones y reuniones no se cubren con créditos de contenido', () => {
    expect(creditKindsForContent('historia')).toEqual([])
    expect(creditKindsForContent('produccion')).toEqual([])
    expect(creditKindsForContent('reunion')).toEqual([])
  })
})

describe('evaluateRegistration', () => {
  const base: RegistrationInput = {
    breakdown: { estatico: 1 },
    totals: { estatico: 4 },
    limits: { estatico: 4 },
    typeCredits: {},
    poolCredits: 0,
    sharedPool: null,
    primaryType: 'estatico',
  }

  it('dentro del cupo del plan: permitido y sin tocar el paquete', () => {
    const v = evaluateRegistration({ ...base, totals: { estatico: 2 }, poolCredits: 10 })
    expect(v).toMatchObject({ allowed: true, usesPackage: false, packageUnits: 0, exceedsPlan: false })
  })

  it('sin paquete reproduce la regla anterior: excede el cupo y no se permite', () => {
    const v = evaluateRegistration(base)
    expect(v).toMatchObject({ allowed: false, usesPackage: false, exceedsPlan: true })
  })

  it('con paquete, el excedente se cubre y se descuenta del paquete', () => {
    const v = evaluateRegistration({ ...base, poolCredits: 3 })
    expect(v).toMatchObject({ allowed: true, usesPackage: true, packageUnits: 1, exceedsPlan: true })
  })

  it('el paquete sin saldo no cubre nada', () => {
    expect(evaluateRegistration({ ...base, poolCredits: 0 }).allowed).toBe(false)
  })

  it('un crédito específico del tipo cubre antes que el paquete (no se marca uso de paquete)', () => {
    const v = evaluateRegistration({ ...base, typeCredits: { estatico: 2 }, poolCredits: 5 })
    expect(v).toMatchObject({ allowed: true, usesPackage: false, exceedsPlan: true })
  })

  it('el paquete cubre un tipo que el plan mensual ni incluye', () => {
    const v = evaluateRegistration({
      ...base,
      breakdown: { reel: 1 },
      totals: {},
      limits: {},
      primaryType: 'reel',
      poolCredits: 1,
    })
    expect(v).toMatchObject({ allowed: true, usesPackage: true, packageUnits: 1 })
  })

  it('la historia derivada fuera de cupo NO la cubre el paquete', () => {
    const v = evaluateRegistration({
      ...base,
      breakdown: { estatico: 1, historia: 1 },
      totals: { estatico: 0, historia: 8 },
      limits: { estatico: 4, historia: 8 },
      poolCredits: 10,
    })
    expect(v.allowed).toBe(false)
  })

  it('el saldo se agota: no cubre más unidades de las que tiene', () => {
    const v = evaluateRegistration({
      ...base,
      breakdown: { estatico: 2 },
      poolCredits: 1,
    })
    expect(v.allowed).toBe(false)
  })

  describe('plan de cupo compartido', () => {
    const shared: RegistrationInput = {
      ...base,
      limits: {},
      totals: {},
      sharedPool: { used: 10, limit: 10 },
    }
    it('con el cupo lleno y sin paquete no se permite', () => {
      expect(evaluateRegistration(shared)).toMatchObject({ allowed: false, exceedsPlan: true })
    })
    it('con el cupo lleno y paquete, se cubre con el paquete', () => {
      expect(evaluateRegistration({ ...shared, poolCredits: 2 })).toMatchObject({
        allowed: true,
        usesPackage: true,
        packageUnits: 1,
      })
    })
    it('con cupo disponible no toca el paquete', () => {
      expect(
        evaluateRegistration({ ...shared, sharedPool: { used: 3, limit: 10 }, poolCredits: 5 }),
      ).toMatchObject({ allowed: true, usesPackage: false, exceedsPlan: false })
    })
  })
})
