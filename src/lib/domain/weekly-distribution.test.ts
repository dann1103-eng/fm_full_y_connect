import { describe, it, expect } from 'vitest'
import {
  augmentDistribution,
  applyOverride,
  addRollover,
  buildProrateOverride,
  buildAccumulateOverride,
} from './weekly-distribution'
import type { ContentType, WeeklyDistribution } from '@/types/db'

const EMPTY_LIMITS: Record<ContentType, number> = {
  historia: 0, estatico: 0, video_corto: 0, reel: 0,
  short: 0, produccion: 0, reunion: 0, matriz_contenido: 0,
}

describe('augmentDistribution', () => {
  it('preserva valores explícitos y llena huecos con ceil(limit/4)', () => {
    const base: WeeklyDistribution = {
      S1: { historia: 2 }, S2: { historia: 2 }, S3: { historia: 2 }, S4: { historia: 2 },
    }
    const limits: Record<ContentType, number> = { ...EMPTY_LIMITS, historia: 8, estatico: 4 }
    const result = augmentDistribution(base, ['historia', 'estatico'], limits)
    expect(result.S1).toEqual({ historia: 2, estatico: 1 })
    expect(result.S4).toEqual({ historia: 2, estatico: 1 })
  })

  it('omite tipos con limit 0', () => {
    const base: WeeklyDistribution = { S1: {}, S2: {}, S3: {}, S4: {} }
    const result = augmentDistribution(base, ['reel'], EMPTY_LIMITS)
    expect(result.S1).toEqual({})
  })

  it('respeta cero explícito — no cae al fallback', () => {
    const base: WeeklyDistribution = {
      S1: { video_corto: 1, reel: 0 },
      S2: { video_corto: 0, reel: 1 },
      S3: { video_corto: 1, reel: 0 },
      S4: { video_corto: 0, reel: 1 },
    }
    const limits: Record<ContentType, number> = { ...EMPTY_LIMITS, video_corto: 2, reel: 2 }
    const result = augmentDistribution(base, ['video_corto', 'reel'], limits)
    expect(result.S1?.video_corto).toBe(1)
    expect(result.S1?.reel).toBeUndefined()
    expect(result.S2?.video_corto).toBeUndefined()
    expect(result.S2?.reel).toBe(1)
  })
})

describe('applyOverride', () => {
  it('null/undefined retorna la base sin cambios', () => {
    const base: WeeklyDistribution = { S1: { historia: 2 }, S2: {}, S3: {}, S4: {} }
    expect(applyOverride(base, null)).toEqual(base)
    expect(applyOverride(base, undefined)).toEqual(base)
  })

  it('reemplaza sólo los tipos presentes en el override', () => {
    const base: WeeklyDistribution = {
      S1: { historia: 2, estatico: 1 },
      S2: { historia: 2, estatico: 1 },
      S3: { historia: 2, estatico: 1 },
      S4: { historia: 2, estatico: 1 },
    }
    const override: WeeklyDistribution = {
      S1: { historia: 3 }, S2: { historia: 3 }, S3: { historia: 2 }, S4: { historia: 2 },
    }
    const result = applyOverride(base, override)
    expect(result.S1).toEqual({ historia: 3, estatico: 1 })
    expect(result.S3).toEqual({ historia: 2, estatico: 1 })
  })
})

describe('addRollover', () => {
  it('rollover de 3 historias → 1,1,1,0', () => {
    const base: WeeklyDistribution = {
      S1: { historia: 2 }, S2: { historia: 2 }, S3: { historia: 2 }, S4: { historia: 2 },
    }
    const result = addRollover(base, { historia: 3 })
    expect(result.S1?.historia).toBe(3)
    expect(result.S2?.historia).toBe(3)
    expect(result.S3?.historia).toBe(3)
    expect(result.S4?.historia).toBe(2)
  })

  it('rollover de 5 historias → 2,1,1,1', () => {
    const base: WeeklyDistribution = {
      S1: { historia: 2 }, S2: { historia: 2 }, S3: { historia: 2 }, S4: { historia: 2 },
    }
    const result = addRollover(base, { historia: 5 })
    expect(result.S1?.historia).toBe(4)
    expect(result.S2?.historia).toBe(3)
    expect(result.S3?.historia).toBe(3)
    expect(result.S4?.historia).toBe(3)
  })

  it('rollover 0 no altera la distribución', () => {
    const base: WeeklyDistribution = { S1: { historia: 2 }, S2: { historia: 2 }, S3: { historia: 2 }, S4: { historia: 2 } }
    expect(addRollover(base, {})).toEqual(base)
  })
})

describe('buildProrateOverride', () => {
  it('+4 historias → +1 por semana', () => {
    const base: WeeklyDistribution = {
      S1: { historia: 2 }, S2: { historia: 2 }, S3: { historia: 2 }, S4: { historia: 2 },
    }
    const result = buildProrateOverride(base, { historia: 4 })
    expect(result.S1?.historia).toBe(3)
    expect(result.S4?.historia).toBe(3)
  })

  it('+2 historias → S1=3 S2=3 S3=2 S4=2', () => {
    const base: WeeklyDistribution = {
      S1: { historia: 2 }, S2: { historia: 2 }, S3: { historia: 2 }, S4: { historia: 2 },
    }
    const result = buildProrateOverride(base, { historia: 2 })
    expect(result.S1?.historia).toBe(3)
    expect(result.S2?.historia).toBe(3)
    expect(result.S3?.historia).toBe(2)
    expect(result.S4?.historia).toBe(2)
  })

  it('delta negativo: reel -1 (base 0,1,0,1 → target 1) → S1=1 S2=0 S3=0 S4=0', () => {
    const base: WeeklyDistribution = {
      S1: { reel: 0 }, S2: { reel: 1 }, S3: { reel: 0 }, S4: { reel: 1 },
    }
    const result = buildProrateOverride(base, { reel: -1 })
    expect(result.S1?.reel).toBe(1)
    expect(result.S2?.reel).toBe(0)
    expect(result.S3?.reel).toBe(0)
    expect(result.S4?.reel).toBe(0)
  })
})

describe('buildAccumulateOverride', () => {
  it('acumula todo el delta en la semana seleccionada', () => {
    const base: WeeklyDistribution = {
      S1: { historia: 2 }, S2: { historia: 2 }, S3: { historia: 2 }, S4: { historia: 2 },
    }
    const result = buildAccumulateOverride(base, { historia: 2 }, 'S2')
    expect(result.S1?.historia).toBe(2)
    expect(result.S2?.historia).toBe(4)
    expect(result.S3?.historia).toBe(2)
    expect(result.S4?.historia).toBe(2)
  })
})
