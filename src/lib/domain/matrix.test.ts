import { describe, it, expect } from 'vitest'
import { computeTargetPeriods, matrixTitleFor, periodLabel, resolveMatrixLimits, computeMatrixUsage, usageTone, proposeDeadline, limitsForDistribution, canTransition, validateForApproval, validateItemPatch, shiftDeadline, sanitizeTopics, compareMatrixItems, isIsoDate, pickCycleForPeriod, canCreateMatrixForClient } from './matrix'
import type { MatrixLimits } from './matrix'
import type { BillingCycle, MatrixTopic, Plan, Requirement } from '@/types/db'
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
  it('título es independiente de la zona horaria del proceso', () => {
    expect(matrixTitleFor('2026-01-18', '2026-02-17')).toBe('Matriz febrero 2026')
  })
})

const PLAN_LIMITS = { historias: 4, estaticos: 4, videos_cortos: 2, reels: 2, shorts: 4, producciones: 1, reuniones: 1, matrices_contenido: 1 }
const plan = { id: 'p1', limits_json: PLAN_LIMITS, unified_content_limit: null } as unknown as Plan
const poolPlan = { id: 'p2', limits_json: { ...PLAN_LIMITS, historias: 0, estaticos: 0, videos_cortos: 0, reels: 0, shorts: 0 }, unified_content_limit: 10 } as unknown as Plan

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

  it('créditos consumidos en el ciclo vuelven al cupo: el requerimiento pagado con crédito ya cuenta en cycleTotals', () => {
    const cycle = cycleWith({ content_limits_override_json: { reel: 4 } })
    const credits = { reel: 1 }
    const cycleRequirements = [
      req('reel'), req('reel'), req('reel'), req('reel'),
      req('reel', { paid_from_credit_id: 'credit-1' }),
    ]
    const r = resolveMatrixLimits({ cycle, plan, cycleRequirements, credits })
    expect(r.cycleTotals.reel).toBe(5)
    expect(r.credits.reel).toBe(2)
    expect(credits).toEqual({ reel: 1 }) // no muta la entrada

    const u = computeMatrixUsage([{ id: 'x', content_type: 'reel', deadline: '2026-10-20', created_at: '2026-09-01T00:00:00Z', status: 'planned' }], r)
    expect(u.overPlanItemIds).toEqual([])
    expect(u.byType.reel).toMatchObject({ used: 6, limit: 4, credits: 2, over: 0 })
  })

  it('créditos consumidos: un requerimiento anulado o arrastrado no los devuelve', () => {
    const cycle = cycleWith({ content_limits_override_json: { reel: 4 } })
    const r = resolveMatrixLimits({
      cycle, plan, credits: { reel: 1 },
      cycleRequirements: [
        req('reel', { paid_from_credit_id: 'credit-1', voided: true }),
        req('reel', { paid_from_credit_id: 'credit-2', carried_over: true }),
      ],
    })
    expect(r.credits.reel).toBe(1)
  })

  it('créditos consumidos: sin override que anule su tipo; un tipo sin crédito asociado no suma', () => {
    const cycle = cycleWith({})
    const r = resolveMatrixLimits({
      cycle, plan, credits: {},
      cycleRequirements: [
        req('estatico', { paid_from_credit_id: 'c1', consumption_overrides_json: { estatico: 0, historia: 1 } }),
        req('historia', { paid_from_credit_id: 'c2' }),
        req('short', { paid_from_credit_id: 'c3', includes_story: true }),
      ],
    })
    expect(r.credits).toEqual({ short: 1 })
  })

  it('créditos consumidos bajo pool unificado amplían los créditos del pool', () => {
    const cycle = cycleWith({ limits_snapshot_json: { ...PLAN_LIMITS, historias: 0, estaticos: 0, videos_cortos: 0, reels: 0, shorts: 0, unified_content_limit: 2 } })
    const r = resolveMatrixLimits({
      cycle, plan, credits: {},
      cycleRequirements: [req('estatico'), req('reel'), req('short', { paid_from_credit_id: 'c1' })],
    })
    const u = computeMatrixUsage([], r)
    expect(u.pool).toEqual({ used: 3, limit: 2, credits: 1 })
  })

  it('sin ciclo: los créditos no cambian', () => {
    const credits = { reel: 1 }
    const r = resolveMatrixLimits({ cycle: null, plan, cycleRequirements: [req('reel', { paid_from_credit_id: 'c1' })], credits })
    expect(r.credits).toEqual({ reel: 1 })
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

  it('rompe empates (misma fecha, misma creación) por id, de forma estable ante el orden de entrada', () => {
    const sameDeadline = '2026-10-20'
    const sameCreated = '2026-09-01T00:00:00Z'
    const a = { id: 'a', content_type: 'estatico' as const, deadline: sameDeadline, created_at: sameCreated, status: 'planned' as const }
    const b = { id: 'b', content_type: 'estatico' as const, deadline: sameDeadline, created_at: sameCreated, status: 'planned' as const }
    expect(computeMatrixUsage([b, a], baseML).overPlanItemIds).toEqual(['b'])
    expect(computeMatrixUsage([a, b], baseML).overPlanItemIds).toEqual(['b'])
  })
})

describe('compareMatrixItems', () => {
  it('ordena por deadline, luego created_at numérico (no localeCompare), luego id', () => {
    const a = { deadline: '2026-09-01T10:00:07+00:00', created_at: '2026-09-01T10:00:07+00:00', id: 'a' }
    const b = { deadline: '2026-09-01T10:00:07+00:00', created_at: '2026-09-01T10:00:07.1+00:00', id: 'b' }
    expect(compareMatrixItems(a, b)).toBeLessThan(0)
    expect(compareMatrixItems(b, a)).toBeGreaterThan(0)
  })
})

describe('usageTone', () => {
  it('verde al llenar, rojo al pasarse contando créditos, neutro en el resto', () => {
    expect(usageTone(2, 2, 0)).toBe('full')
    expect(usageTone(3, 2, 0)).toBe('over')
    expect(usageTone(3, 2, 1)).toBe('neutral')
    expect(usageTone(1, 2, 0)).toBe('neutral')
  })
  it('con límite 0, used===limit no cuenta como lleno', () => {
    expect(usageTone(0, 0, 2)).toBe('neutral')
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

  describe('con `today`: no propone fechas pasadas', () => {
    const withToday = { S1: { estatico: 1 }, S2: { estatico: 1 }, S3: { estatico: 1 }, S4: { estatico: 1 } }
    it('salta semanas ya cerradas y usa +2 días de la primera con hueco vigente', () => {
      const r = proposeDeadline({ contentType: 'estatico', items: [], distribution: withToday, ...period, today: '2026-10-30' })
      expect(r).toBe('2026-10-31')
    })
    it('si la candidata natural quedó en el pasado, usa hoy', () => {
      const r = proposeDeadline({ contentType: 'estatico', items: [], distribution: withToday, ...period, today: '2026-11-02' })
      expect(r).toBe('2026-11-02')
    })
    it('si todas las semanas ya cerraron, usa hoy acotado al fin del período', () => {
      const r = proposeDeadline({ contentType: 'estatico', items: [], distribution: withToday, ...period, today: '2026-11-20' })
      expect(r).toBe('2026-11-14')
    })
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
  it('rechaza fechas mal formadas o inexistentes en el calendario', () => {
    expect(validateItemPatch({ deadline: '2026-10-2' }, ctx).ok).toBe(false)
    expect(validateItemPatch({ deadline: '2026-02-30' }, ctx).ok).toBe(false)
    expect(validateItemPatch({ deadline: 'abc' }, ctx).ok).toBe(false)
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

  it('ignora entradas malformadas (name no-string, elementos null) en vez de lanzar', () => {
    const raw = [{ name: 42 }, null, { name: 'Ok', note: 5 }] as unknown as MatrixTopic[]
    expect(sanitizeTopics(raw)).toEqual([{ name: 'Ok' }])
  })

  it('recorta por code points, sin partir un emoji a la mitad', () => {
    const name = 'a'.repeat(59) + '😀' + 'b'
    expect(sanitizeTopics([{ name }])).toEqual([{ name: 'a'.repeat(59) + '😀' }])
  })

  it('limita a 20 temas', () => {
    const raw = Array.from({ length: 25 }, (_, i) => ({ name: `Tema ${i}` }))
    expect(sanitizeTopics(raw)).toHaveLength(20)
  })

  it('devuelve [] si el input no es un array (null, undefined, objeto)', () => {
    expect(sanitizeTopics(null as unknown as MatrixTopic[])).toEqual([])
    expect(sanitizeTopics(undefined as unknown as MatrixTopic[])).toEqual([])
    expect(sanitizeTopics({ name: 'x' } as unknown as MatrixTopic[])).toEqual([])
  })
})

describe('isIsoDate', () => {
  it('acepta fechas YYYY-MM-DD existentes en el calendario', () => {
    expect(isIsoDate('2026-10-15')).toBe(true)
    expect(isIsoDate('2028-02-29')).toBe(true)
  })
  it('rechaza formatos incorrectos y fechas inexistentes', () => {
    expect(isIsoDate('2026-10-2')).toBe(false)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2027-02-29')).toBe(false)
    expect(isIsoDate('abc')).toBe(false)
    expect(isIsoDate('')).toBe(false)
    expect(isIsoDate('2026-10-15T00:00:00Z')).toBe(false)
  })
  it('devuelve false (sin lanzar) para valores que no son string', () => {
    expect(isIsoDate(['2026-10-15'] as unknown as string)).toBe(false)
    expect(isIsoDate(null as unknown as string)).toBe(false)
    expect(isIsoDate(20261015 as unknown as string)).toBe(false)
  })
})

describe('pickCycleForPeriod', () => {
  const c = (id: string, status: BillingCycle['status'], created_at: string) => ({ id, status, created_at })

  it('devuelve null sin ciclos', () => {
    expect(pickCycleForPeriod([])).toBeNull()
  })

  it('prioriza current > pending_renewal > scheduled > archived aunque haya uno más nuevo', () => {
    const cycles = [
      c('arch', 'archived', '2026-09-10T00:00:00Z'),
      c('sch', 'scheduled', '2026-09-09T00:00:00Z'),
      c('cur', 'current', '2026-09-01T00:00:00Z'),
      c('pen', 'pending_renewal', '2026-09-08T00:00:00Z'),
    ]
    expect(pickCycleForPeriod(cycles)?.id).toBe('cur')
    expect(pickCycleForPeriod(cycles.filter((x) => x.id !== 'cur'))?.id).toBe('pen')
    expect(pickCycleForPeriod(cycles.filter((x) => x.id === 'arch' || x.id === 'sch'))?.id).toBe('sch')
  })

  it('con el mismo estado elige el created_at más reciente', () => {
    const cycles = [
      c('viejo', 'scheduled', '2026-09-01T10:00:00+00:00'),
      c('nuevo', 'scheduled', '2026-09-02T09:00:00+00:00'),
      c('medio', 'scheduled', '2026-09-01T23:00:00+00:00'),
    ]
    expect(pickCycleForPeriod(cycles)?.id).toBe('nuevo')
  })
})

describe('canCreateMatrixForClient', () => {
  it('permite active, paused y overdue', () => {
    expect(canCreateMatrixForClient('active')).toBe(true)
    expect(canCreateMatrixForClient('paused')).toBe(true)
    expect(canCreateMatrixForClient('overdue')).toBe(true)
  })

  it('bloquea inactive_payment e inactive_manual', () => {
    expect(canCreateMatrixForClient('inactive_payment')).toBe(false)
    expect(canCreateMatrixForClient('inactive_manual')).toBe(false)
  })
})
