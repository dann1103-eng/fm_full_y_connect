import { describe, it, expect } from 'vitest'
import { computeTargetPeriods, matrixTitleFor, periodLabel, resolveMatrixLimits, computeMatrixUsage, usageTone, proposeDeadline, limitsForDistribution, canTransition, validateForApproval, validateItemPatch, shiftDeadline, sanitizeTopics } from './matrix'
import type { MatrixLimits } from './matrix'
import type { BillingCycle, Plan, Requirement } from '@/types/db'
import { buildEffectiveDistribution } from './weekly-distribution'
import { WEEKS_BIMONTHLY } from '@/types/db'

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

type UItem = { id: string; content_type: Requirement['content_type']; deadline: string; created_at: string; status: 'planned' | 'converted' | 'blocked' }
function item(id: string, content_type: UItem['content_type'], deadline: string, status: UItem['status'] = 'planned'): UItem {
  return { id, content_type, deadline, created_at: `2026-09-01T00:00:${id.padStart(2, '0')}Z`, status }
}
const baseML: MatrixLimits = {
  limits: { historia: 2, estatico: 2, video_corto: 1, reel: 0, short: 0, produccion: 0, reunion: 0, matriz_contenido: 1 },
  cycleTotals: { historia: 0, estatico: 1, video_corto: 0, reel: 0, short: 0, produccion: 0, reunion: 0, matriz_contenido: 0 },
  credits: {}, unifiedPool: null, estimated: false,
}

describe('computeMatrixUsage', () => {
  it('marca fuera de plan en orden de fecha, contando lo ya consumido en el ciclo', () => {
    const items = [item('1', 'estatico', '2026-10-20'), item('2', 'estatico', '2026-10-17'), item('3', 'estatico', '2026-10-25')]
    const u = computeMatrixUsage(items, baseML)
    expect(u.overPlanItemIds).toEqual(['1', '3'])
    expect(u.byType.estatico).toMatchObject({ planned: 3, used: 4, limit: 2, over: 2 })
  })

  it('los créditos amplían el cupo', () => {
    const items = [item('1', 'estatico', '2026-10-17'), item('2', 'estatico', '2026-10-18')]
    const u = computeMatrixUsage(items, { ...baseML, credits: { estatico: 1 } })
    expect(u.overPlanItemIds).toEqual([])
  })

  it('excluye piezas convertidas del conteo planificado', () => {
    const items = [item('1', 'estatico', '2026-10-17', 'converted'), item('2', 'estatico', '2026-10-18')]
    const u = computeMatrixUsage(items, baseML)
    expect(u.byType.estatico.planned).toBe(1)
    expect(u.overPlanItemIds).toEqual([])
  })

  it('pool unificado: contador compartido; historia fuera del pool con límite 0', () => {
    const ml: MatrixLimits = {
      ...baseML,
      limits: { ...baseML.limits, historia: 0, estatico: 0, video_corto: 0, reel: 0, short: 0 },
      cycleTotals: { ...baseML.cycleTotals, estatico: 0 },
      unifiedPool: 2,
    }
    const items = [item('1', 'estatico', '2026-10-17'), item('2', 'reel', '2026-10-18'), item('3', 'short', '2026-10-19'), item('4', 'historia', '2026-10-20')]
    const u = computeMatrixUsage(items, ml)
    expect(u.pool).toEqual({ used: 3, limit: 2, credits: 0 })
    expect(u.overPlanItemIds).toEqual(['3', '4'])
    expect(u.activeTypes).toEqual(['historia', 'estatico', 'video_corto', 'reel', 'short'])
  })

  it('tipos activos: limit > 0 || credits > 0 || planned > 0', () => {
    const u = computeMatrixUsage([item('1', 'short', '2026-10-17')], { ...baseML, credits: { reel: 1 } })
    expect(u.activeTypes).toEqual(['historia', 'estatico', 'video_corto', 'reel', 'short'])
    const u2 = computeMatrixUsage([], baseML)
    expect(u2.activeTypes).toEqual(['historia', 'estatico', 'video_corto'])
  })
})

describe('usageTone', () => {
  it('verde al llenar, rojo al pasarse contando créditos, neutro en el resto', () => {
    expect(usageTone(2, 2, 0)).toBe('full')
    expect(usageTone(3, 2, 0)).toBe('over')
    expect(usageTone(3, 2, 1)).toBe('neutral')
    expect(usageTone(1, 2, 0)).toBe('neutral')
  })
})

describe('proposeDeadline', () => {
  const dist = { S1: { estatico: 1 }, S2: { estatico: 1 }, S3: {}, S4: { estatico: 1 } }
  const period = { periodStart: '2026-10-15', periodEnd: '2026-11-14', maxWeek: 4 as const }

  it('primera semana con hueco → inicio + 2 días', () => {
    expect(proposeDeadline({ contentType: 'estatico', items: [], distribution: dist, ...period })).toBe('2026-10-17')
  })
  it('S1 ocupada → S2', () => {
    const items = [{ content_type: 'estatico' as const, deadline: '2026-10-16' }]
    expect(proposeDeadline({ contentType: 'estatico', items, distribution: dist, ...period })).toBe('2026-10-24')
  })
  it('sin hueco en ninguna → última semana', () => {
    const items = [
      { content_type: 'estatico' as const, deadline: '2026-10-16' },
      { content_type: 'estatico' as const, deadline: '2026-10-23' },
      { content_type: 'estatico' as const, deadline: '2026-11-06' },
    ]
    expect(proposeDeadline({ contentType: 'estatico', items, distribution: dist, ...period })).toBe('2026-11-07')
  })
  it('recorta a period_end (quincenal con 4 semanas)', () => {
    const r = proposeDeadline({ contentType: 'reel', items: [], distribution: {}, periodStart: '2026-09-01', periodEnd: '2026-09-14', maxWeek: 4 })
    expect(r).toBe('2026-09-14')
  })
  it('tipos compartidos (pool) cuentan juntos en la semana', () => {
    const d = { S1: { estatico: 1, reel: 1 }, S2: { estatico: 1, reel: 1 }, S3: {}, S4: {} }
    const items = [{ content_type: 'reel' as const, deadline: '2026-10-16' }]
    const r = proposeDeadline({ contentType: 'estatico', items, distribution: d, ...period, sharedTypes: ['estatico', 'video_corto', 'reel', 'short'] })
    expect(r).toBe('2026-10-24')
  })
  it('8 semanas: propone en S5..S8 cuando la distribución las trae', () => {
    const limits = { historia: 0, estatico: 8, video_corto: 0, reel: 0, short: 0, produccion: 0, reunion: 0, matriz_contenido: 1 }
    const d = buildEffectiveDistribution({ clientDistribution: null, planDistribution: null, pipelineTypes: ['estatico'], limits, weeks: WEEKS_BIMONTHLY })
    const items = ['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23'].map((deadline) => ({ content_type: 'estatico' as const, deadline }))
    const r = proposeDeadline({ contentType: 'estatico', items, distribution: d, periodStart: '2026-09-01', periodEnd: '2026-10-30', maxWeek: 8 })
    expect(r).toBe('2026-10-01')
  })
})

describe('limitsForDistribution', () => {
  it('sin pool devuelve los límites tal cual', () => {
    expect(limitsForDistribution(baseML)).toEqual(baseML.limits)
  })
  it('con pool asigna el pool a cada tippable', () => {
    const r = limitsForDistribution({ ...baseML, unifiedPool: 10 })
    expect(r.estatico).toBe(10)
    expect(r.short).toBe(10)
    expect(r.historia).toBe(baseML.limits.historia)
  })
})

describe('canTransition', () => {
  const ctx = { hasConvertedItems: false }
  it('draft → approved, approved → draft, cualquiera → closed', () => {
    expect(canTransition('draft', 'approved', ctx)).toBe(true)
    expect(canTransition('approved', 'draft', ctx)).toBe(true)
    expect(canTransition('draft', 'closed', ctx)).toBe(true)
    expect(canTransition('approved', 'closed', ctx)).toBe(true)
  })
  it('closed es terminal; approved → draft bloqueado con convertidas; mismo estado no', () => {
    expect(canTransition('closed', 'draft', ctx)).toBe(false)
    expect(canTransition('approved', 'draft', { hasConvertedItems: true })).toBe(false)
    expect(canTransition('draft', 'draft', ctx)).toBe(false)
  })
})

describe('validateForApproval', () => {
  const period = { periodStart: '2026-10-15', periodEnd: '2026-11-14' }
  it('vacía no aprueba', () => {
    expect(validateForApproval([], period)).toEqual({ ok: false, empty: true, problems: [] })
  })
  it('detecta sin título y fecha fuera de período', () => {
    const r = validateForApproval([
      { id: 'a', title: '', deadline: '2026-10-20' },
      { id: 'b', title: 'Ok', deadline: '2026-12-01' },
      { id: 'c', title: 'Ok', deadline: '2026-10-21' },
    ], period)
    expect(r.ok).toBe(false)
    expect(r.problems).toEqual([
      { itemId: 'a', reason: 'sin_titulo' },
      { itemId: 'b', reason: 'fecha_fuera_de_periodo' },
    ])
  })
})

describe('validateItemPatch', () => {
  const ctx = { periodStart: '2026-10-15', periodEnd: '2026-11-14', topics: [{ name: 'Promo' }] }
  it('acepta fecha dentro, tema existente, objetivo válido', () => {
    expect(validateItemPatch({ deadline: '2026-10-15', topic: 'Promo', objective: 'venta' }, ctx)).toEqual({ ok: true })
    expect(validateItemPatch({ topic: null, objective: null }, ctx)).toEqual({ ok: true })
  })
  it('rechaza fecha fuera, tema desconocido, objetivo inválido, tipo no planificable', () => {
    expect(validateItemPatch({ deadline: '2026-11-15' }, ctx).ok).toBe(false)
    expect(validateItemPatch({ topic: 'Otro' }, ctx).ok).toBe(false)
    expect(validateItemPatch({ objective: 'x' as never }, ctx).ok).toBe(false)
    expect(validateItemPatch({ content_type: 'produccion' }, ctx).ok).toBe(false)
  })
})

describe('shiftDeadline', () => {
  it('mantiene el offset y recorta al final', () => {
    const from = { periodStart: '2026-10-15', periodEnd: '2026-11-14' }
    expect(shiftDeadline('2026-10-20', from, { periodStart: '2026-11-15', periodEnd: '2026-12-14' })).toBe('2026-11-20')
    expect(shiftDeadline('2026-11-10', from, { periodStart: '2026-12-01', periodEnd: '2026-12-14' })).toBe('2026-12-14')
  })
})

describe('sanitizeTopics', () => {
  it('recorta, deduplica sin distinguir mayúsculas y descarta vacíos', () => {
    expect(sanitizeTopics([{ name: ' Promo ' }, { name: 'promo', note: 'x' }, { name: '' }, { name: 'Carta', note: ' n ' }]))
      .toEqual([{ name: 'Promo' }, { name: 'Carta', note: 'n' }])
  })
})
