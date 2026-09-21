import { describe, it, expect } from 'vitest'
import { missingByType, sanitizeGeneratedPlan, sanitizeGeneratedBrief, briefOutcome, assignDeadlines, pendingChildWork, DEFAULT_ESTIMATE_MINUTES } from './matrix-ai'
import type { PlanContext } from './matrix-ai'
import { computeMatrixUsage, resolveMatrixLimits, MATRIX_TEXT_LIMITS, MATRIX_ESTIMATE_MAX_MINUTES } from './matrix'
import type { MatrixLimits } from './matrix'
import type { BillingCycle, ContentType, MatrixTopic, Plan, Requirement, WeeklyDistribution } from '@/types/db'

// ── Fixtures compartidas con matrix.test.ts ─────────────────────────────────

const PLAN_LIMITS = { historias: 4, estaticos: 4, videos_cortos: 2, reels: 2, shorts: 4, producciones: 1, reuniones: 1, matrices_contenido: 1 }
const plan = { id: 'p1', limits_json: PLAN_LIMITS, unified_content_limit: null } as unknown as Plan

function cycleWith(extra: Partial<BillingCycle>): BillingCycle {
  return {
    id: 'c1', limits_snapshot_json: PLAN_LIMITS, rollover_from_previous_json: null,
    content_limits_override_json: null, ...extra,
  } as unknown as BillingCycle
}
function req(content_type: Requirement['content_type'], extra: Partial<Requirement> = {}): Requirement {
  return { id: Math.random().toString(), content_type, voided: false, carried_over: false, includes_story: false, consumption_overrides_json: null, ...extra } as unknown as Requirement
}

type UItem = { id: string; content_type: ContentType; deadline: string; created_at: string; status: 'planned' | 'converted' | 'blocked' }
function item(id: string, content_type: ContentType, deadline: string, status: UItem['status'] = 'planned'): UItem {
  return { id, content_type, deadline, created_at: `2026-09-01T00:00:${id.padStart(2, '0')}Z`, status }
}

const baseML: MatrixLimits = {
  limits: { historia: 2, estatico: 4, video_corto: 1, reel: 0, short: 0, produccion: 0, reunion: 0, matriz_contenido: 1 },
  cycleTotals: { historia: 0, estatico: 1, video_corto: 0, reel: 0, short: 0, produccion: 0, reunion: 0, matriz_contenido: 0 },
  credits: {}, remainingCredits: {}, unifiedPool: null, estimated: false,
}

describe('missingByType', () => {
  it('plan normal: descuenta lo del ciclo y lo ya planificado, por tipo', () => {
    const items = [item('1', 'estatico', '2026-10-17'), item('2', 'historia', '2026-10-18')]
    const usage = computeMatrixUsage(items, baseML)
    const r = missingByType(baseML, usage)
    // estatico: limite 4, 1 del ciclo + 1 planificada → faltan 2
    expect(r.missing.estatico).toBe(2)
    // historia: limite 2, 1 planificada → falta 1
    expect(r.missing.historia).toBe(1)
    expect(r.missing.video_corto).toBe(1)
    expect(r.poolRemaining).toBeNull()
    expect(r.total).toBe(4)
  })

  it('usa los créditos EFECTIVOS, no los disponibles', () => {
    // Ciclo con 4 reels registrados, uno de ellos pagado con crédito: `credits.reel` (efectivos) = 2,
    // `remainingCredits.reel` (disponibles, los del chip) = 1. Con los disponibles faltaría 1 pieza;
    // con los efectivos faltan 2. Calcado del caso de matrix.test.ts.
    const ml = resolveMatrixLimits({
      cycle: cycleWith({ content_limits_override_json: { reel: 4 } }),
      plan,
      credits: { reel: 1 },
      cycleRequirements: [req('reel'), req('reel'), req('reel'), req('reel', { paid_from_credit_id: 'credit-1' })],
    })
    expect(ml.credits.reel).toBe(2)
    expect(ml.remainingCredits.reel).toBe(1)
    const usage = computeMatrixUsage([], ml)
    expect(usage.byType.reel).toMatchObject({ used: 4, limit: 4, credits: 2, availableCredits: 1 })

    const r = missingByType(ml, usage)
    expect(r.missing.reel).toBe(2)
  })

  it('con pool unificado devuelve el total del pool y CERO historias', () => {
    // `historia` entra en activeTypes por tener créditos, pero bajo pool su límite es 0 y una historia
    // nacería fuera de plan y sin semana asignada: la regla es explícita, no derivada de limits.historia.
    const ml: MatrixLimits = {
      ...baseML,
      limits: { ...baseML.limits, historia: 0, estatico: 0, video_corto: 0, reel: 0, short: 0 },
      cycleTotals: { ...baseML.cycleTotals, estatico: 2 },
      credits: { historia: 3 },
      remainingCredits: { historia: 3 },
      unifiedPool: 10,
    }
    const usage = computeMatrixUsage([item('1', 'reel', '2026-10-17')], ml)
    expect(usage.activeTypes).toContain('historia')

    const r = missingByType(ml, usage)
    // pool: 10 de límite + 3 créditos (los de historia suman al pool en computeMatrixUsage) − 3 usadas
    expect(r.poolRemaining).toBe(usage.pool!.limit + usage.pool!.credits - usage.pool!.used)
    expect(r.missing.historia).toBe(0)
    expect(r.total).toBe(r.poolRemaining)
    expect(r.missing.estatico).toBe(r.poolRemaining)
    expect(r.missing.reel).toBe(r.poolRemaining)
  })

  it('nunca propone tipos fuera de activeTypes', () => {
    const usage = computeMatrixUsage([], baseML)
    expect(usage.activeTypes).toEqual(['historia', 'estatico', 'video_corto'])
    const r = missingByType(baseML, usage)
    expect(Object.keys(r.missing).sort()).toEqual(['estatico', 'historia', 'video_corto'])
    expect(r.missing.reel).toBeUndefined()
    expect(r.missing.produccion).toBeUndefined()
  })

  it('matriz llena: todo en cero', () => {
    const items = [
      item('1', 'estatico', '2026-10-17'), item('2', 'estatico', '2026-10-18'), item('3', 'estatico', '2026-10-19'),
      item('4', 'historia', '2026-10-20'), item('5', 'historia', '2026-10-21'),
      item('6', 'video_corto', '2026-10-22'),
    ]
    const usage = computeMatrixUsage(items, baseML)
    const r = missingByType(baseML, usage)
    expect(r.total).toBe(0)
    expect(Object.values(r.missing).every((n) => n === 0)).toBe(true)
  })

  it('pool ya cubierto: total 0, sin negativos', () => {
    const ml: MatrixLimits = { ...baseML, limits: { ...baseML.limits, historia: 0, estatico: 0, video_corto: 0 }, cycleTotals: { ...baseML.cycleTotals, estatico: 5 }, unifiedPool: 2 }
    const usage = computeMatrixUsage([], ml)
    const r = missingByType(ml, usage)
    expect(r.poolRemaining).toBe(0)
    expect(r.total).toBe(0)
  })
})

// ── sanitizeGeneratedPlan ───────────────────────────────────────────────────

const topics: MatrixTopic[] = [{ name: 'Lanzamiento' }, { name: 'Testimonios' }]

function ctxWith(extra: Partial<PlanContext> = {}): PlanContext {
  return {
    activeTypes: ['estatico', 'reel', 'historia'],
    missing: { estatico: 2, reel: 1, historia: 1 },
    poolRemaining: null,
    topics,
    ...extra,
  }
}

function piece(extra: Record<string, unknown> = {}) {
  return { content_type: 'estatico', title: 'Pieza', topic_index: 0, objective: 'venta', needs_production: false, estimated_time_minutes: 60, ...extra }
}

describe('sanitizeGeneratedPlan', () => {
  it('descarta tipos que no se planifican en la matriz', () => {
    const r = sanitizeGeneratedPlan([piece({ content_type: 'produccion' }), piece({ content_type: 'reunion' }), piece({ content_type: 'matriz_contenido' }), piece()], ctxWith())
    expect(r).toHaveLength(1)
    expect(r[0].content_type).toBe('estatico')
  })

  it('descarta tipos inactivos en el plan del cliente', () => {
    const r = sanitizeGeneratedPlan([piece({ content_type: 'short' }), piece({ content_type: 'video_corto' })], ctxWith())
    expect(r).toEqual([])
  })

  it('recorta por tipo al faltante', () => {
    const raw = [piece(), piece(), piece(), piece({ content_type: 'reel' }), piece({ content_type: 'reel' })]
    const r = sanitizeGeneratedPlan(raw, ctxWith())
    expect(r.filter((p) => p.content_type === 'estatico')).toHaveLength(2)
    expect(r.filter((p) => p.content_type === 'reel')).toHaveLength(1)
  })

  it('bajo pool recorta también el TOTAL, no solo por tipo', () => {
    // Bajo pool el tope por tipo es el pool entero para los cuatro tippables: sin el corte del total,
    // 4 tipos × 3 = 12 piezas donde solo caben 3.
    const ctx = ctxWith({
      activeTypes: ['estatico', 'video_corto', 'reel', 'short'],
      missing: { estatico: 3, video_corto: 3, reel: 3, short: 3 },
      poolRemaining: 3,
    })
    const raw = [
      piece({ content_type: 'estatico' }), piece({ content_type: 'estatico' }), piece({ content_type: 'estatico' }),
      piece({ content_type: 'reel' }), piece({ content_type: 'reel' }), piece({ content_type: 'reel' }),
      piece({ content_type: 'short' }), piece({ content_type: 'short' }), piece({ content_type: 'short' }),
      piece({ content_type: 'video_corto' }), piece({ content_type: 'video_corto' }), piece({ content_type: 'video_corto' }),
    ]
    expect(sanitizeGeneratedPlan(raw, ctx)).toHaveLength(3)
  })

  it('descarta el objetivo inventado pero conserva la pieza', () => {
    const r = sanitizeGeneratedPlan([piece({ objective: 'engagement' }), piece({ objective: null }), piece({ objective: 'educacion' })], ctxWith({ missing: { estatico: 5 } }))
    expect(r).toHaveLength(3)
    expect(r[0].objective).toBeNull()
    expect(r[1].objective).toBeNull()
    expect(r[2].objective).toBe('educacion')
  })

  it('descarta piezas sin título o con solo espacios', () => {
    const r = sanitizeGeneratedPlan([piece({ title: '' }), piece({ title: '   ' }), piece({ title: 42 }), piece({ title: '  Con título  ' })], ctxWith({ missing: { estatico: 5 } }))
    expect(r).toHaveLength(1)
    expect(r[0].title).toBe('Con título')
  })

  it('recorta el título al tope de la base', () => {
    const r = sanitizeGeneratedPlan([piece({ title: 'a'.repeat(MATRIX_TEXT_LIMITS.title + 50) })], ctxWith())
    expect(Array.from(r[0].title).length).toBeLessThanOrEqual(MATRIX_TEXT_LIMITS.title)
  })

  it('índice de tema fuera de rango → pieza sin tema, no descartada', () => {
    const r = sanitizeGeneratedPlan(
      [piece({ topic_index: 9 }), piece({ topic_index: -1 }), piece({ topic_index: 'Lanzamiento' }), piece({ topic_index: 1 })],
      ctxWith({ missing: { estatico: 5 } }),
    )
    expect(r).toHaveLength(4)
    expect(r[0].topicIndex).toBeNull()
    expect(r[1].topicIndex).toBeNull()
    expect(r[2].topicIndex).toBeNull()
    expect(r[3].topicIndex).toBe(1)
  })

  it('sin temas en la matriz, todo índice queda en null', () => {
    const r = sanitizeGeneratedPlan([piece({ topic_index: 0 })], ctxWith({ topics: [] }))
    expect(r[0].topicIndex).toBeNull()
  })

  it('acota el estimado absurdo a 1..10080', () => {
    const r = sanitizeGeneratedPlan(
      [piece({ estimated_time_minutes: 0 }), piece({ estimated_time_minutes: -5 }), piece({ estimated_time_minutes: 999999 }), piece({ estimated_time_minutes: 'mucho' }), piece({ estimated_time_minutes: 45.7 })],
      ctxWith({ missing: { estatico: 9 } }),
    )
    expect(r[0].estimated_time_minutes).toBe(1)
    expect(r[1].estimated_time_minutes).toBe(1)
    expect(r[2].estimated_time_minutes).toBe(MATRIX_ESTIMATE_MAX_MINUTES)
    expect(r[3].estimated_time_minutes).toBe(DEFAULT_ESTIMATE_MINUTES)
    expect(r[4].estimated_time_minutes).toBe(46)
  })

  it('needs_production que no es booleano → false', () => {
    const r = sanitizeGeneratedPlan([piece({ needs_production: 'sí' }), piece({ needs_production: true })], ctxWith({ missing: { estatico: 5 } }))
    expect(r[0].needs_production).toBe(false)
    expect(r[1].needs_production).toBe(true)
  })

  it('entrada que no es un array → lista vacía', () => {
    expect(sanitizeGeneratedPlan(null, ctxWith())).toEqual([])
    expect(sanitizeGeneratedPlan(undefined, ctxWith())).toEqual([])
    expect(sanitizeGeneratedPlan({ pieces: [piece()] }, ctxWith())).toEqual([])
    expect(sanitizeGeneratedPlan('[]', ctxWith())).toEqual([])
    expect(sanitizeGeneratedPlan([null, 3, 'x'], ctxWith())).toEqual([])
  })
})

// ── sanitizeGeneratedBrief ──────────────────────────────────────────────────

describe('sanitizeGeneratedBrief', () => {
  it('recorta cada campo a su tope cortando en el último espacio', () => {
    const long = ('palabra '.repeat(400)).trim() // 3199 caracteres
    const r = sanitizeGeneratedBrief({ visual_style: long })
    const out = r.visual_style as string
    expect(Array.from(out).length).toBeLessThanOrEqual(MATRIX_TEXT_LIMITS.visual_style)
    expect(out.endsWith('palabra')).toBe(true)
    expect(out).not.toMatch(/palabr$/)
  })

  it('recorta por code points sin partir emojis', () => {
    const emojis = '🎉'.repeat(MATRIX_TEXT_LIMITS.cta + 100)
    const out = sanitizeGeneratedBrief({ cta: emojis }).cta as string
    expect(Array.from(out).length).toBe(MATRIX_TEXT_LIMITS.cta)
    expect(out).toBe('🎉'.repeat(MATRIX_TEXT_LIMITS.cta))
    // Sin mitades de par sustituto sueltas
    expect([...out].every((c) => c === '🎉')).toBe(true)
  })

  it('corta en el último espacio también con emojis de por medio', () => {
    const chunk = '🎉🎉🎉 '
    const out = sanitizeGeneratedBrief({ cta: chunk.repeat(1000) }).cta as string
    expect(Array.from(out).length).toBeLessThanOrEqual(MATRIX_TEXT_LIMITS.cta)
    expect(out.endsWith('🎉')).toBe(true)
    expect([...out].every((c) => c === '🎉' || c === ' ')).toBe(true)
  })

  it('campos ausentes o que no son string se omiten (no se escriben como "undefined")', () => {
    const r = sanitizeGeneratedBrief({ copy: 'Hola', script: 42, visual_style: null, cta: undefined })
    expect(r).toEqual({ copy: 'Hola' })
    expect('script' in r).toBe(false)
    expect('visual_style' in r).toBe(false)
    expect('cta' in r).toBe(false)
  })

  it('hashtags y CTA vacíos son válidos: limpian el campo', () => {
    const r = sanitizeGeneratedBrief({ hashtags: '', cta: '   ' })
    expect(r.hashtags).toBeNull()
    expect(r.cta).toBeNull()
  })

  it('objetivo válido se conserva, inventado se omite', () => {
    expect(sanitizeGeneratedBrief({ objective: 'comunidad' }).objective).toBe('comunidad')
    expect('objective' in sanitizeGeneratedBrief({ objective: 'viral' })).toBe(false)
  })

  it('needs_production solo si es booleano', () => {
    expect(sanitizeGeneratedBrief({ needs_production: true }).needs_production).toBe(true)
    expect('needs_production' in sanitizeGeneratedBrief({ needs_production: 'sí' })).toBe(false)
  })

  it('DESCARTA toda clave que no sea del brief', () => {
    // Sin esto, una pieza ya convertida perdería sus campos congelados si el modelo los inventa.
    const r = sanitizeGeneratedBrief({
      copy: 'Texto',
      title: 'Título nuevo',
      content_type: 'reel',
      deadline: '2026-12-31',
      status: 'planned',
      assigned_to: ['00000000-0000-0000-0000-000000000000'],
      estimated_time_minutes: 30,
      id: 'otro-id',
      matrix_id: 'otra-matriz',
      requirement_id: 'req',
      ai_written_at: '2026-01-01T00:00:00Z',
      topic: 'Tema inventado',
    })
    expect(Object.keys(r)).toEqual(['copy'])
  })

  it('entrada que no es un objeto → parche vacío', () => {
    expect(sanitizeGeneratedBrief(null)).toEqual({})
    expect(sanitizeGeneratedBrief('copy')).toEqual({})
    expect(sanitizeGeneratedBrief([{ copy: 'x' }])).toEqual({})
  })
})

// ── assignDeadlines ─────────────────────────────────────────────────────────

describe('assignDeadlines', () => {
  const period = { periodStart: '2026-10-15', periodEnd: '2026-11-14', maxWeek: 4 as const }
  const poolDist: WeeklyDistribution = {
    S1: { estatico: 2, video_corto: 2, reel: 2, short: 2 },
    S2: { estatico: 2, video_corto: 2, reel: 2, short: 2 },
    S3: { estatico: 2, video_corto: 2, reel: 2, short: 2 },
    S4: { estatico: 2, video_corto: 2, reel: 2, short: 2 },
  }
  const shared: ContentType[] = ['estatico', 'video_corto', 'reel', 'short']

  function gen(content_type: ContentType) {
    return { content_type, title: 'T', topicIndex: null, objective: null, needs_production: false, estimated_time_minutes: 60 }
  }

  it('con la matriz ya poblada y bajo pool: ve lo existente y reparte el presupuesto compartido', () => {
    // La S1 ya está llena con dos piezas de tipos DISTINTOS: bajo pool comparten presupuesto, así que
    // ninguna de las nuevas puede caer en S1 aunque su propio tipo no tenga nada esa semana.
    const existing = [
      { content_type: 'reel' as ContentType, deadline: '2026-10-16' },
      { content_type: 'estatico' as ContentType, deadline: '2026-10-17' },
    ]
    const r = assignDeadlines([gen('estatico'), gen('short'), gen('video_corto'), gen('reel')], {
      existingItems: existing, distribution: poolDist, ...period, sharedTypes: shared, today: '2026-10-15',
    })
    expect(r.map((p) => p.deadline)).toEqual(['2026-10-24', '2026-10-24', '2026-10-31', '2026-10-31'])
  })

  it('sin las piezas existentes como semilla se amontonarían en la semana 1 (contraste)', () => {
    const r = assignDeadlines([gen('estatico'), gen('short'), gen('video_corto')], {
      existingItems: [], distribution: poolDist, ...period, sharedTypes: shared, today: '2026-10-15',
    })
    expect(r.map((p) => p.deadline)).toEqual(['2026-10-17', '2026-10-17', '2026-10-24'])
  })

  it('sin pool cada tipo consume su propio presupuesto semanal', () => {
    const dist: WeeklyDistribution = { S1: { estatico: 1, historia: 1 }, S2: { estatico: 1, historia: 1 }, S3: {}, S4: {} }
    const r = assignDeadlines([gen('estatico'), gen('historia'), gen('estatico')], {
      existingItems: [], distribution: dist, ...period, today: '2026-10-15',
    })
    expect(r.map((p) => p.deadline)).toEqual(['2026-10-17', '2026-10-17', '2026-10-24'])
  })

  it('respeta el período y nunca propone una fecha anterior a hoy', () => {
    const r = assignDeadlines([gen('estatico'), gen('estatico'), gen('estatico')], {
      existingItems: [], distribution: poolDist, ...period, sharedTypes: shared, today: '2026-11-02',
    })
    for (const p of r) {
      expect(p.deadline >= '2026-11-02').toBe(true)
      expect(p.deadline >= period.periodStart).toBe(true)
      expect(p.deadline <= period.periodEnd).toBe(true)
    }
  })

  it('conserva el resto de los campos de la pieza', () => {
    const r = assignDeadlines([{ ...gen('estatico'), title: 'Mi pieza', topicIndex: 1 }], {
      existingItems: [], distribution: poolDist, ...period, today: '2026-10-15',
    })
    expect(r[0]).toMatchObject({ title: 'Mi pieza', topicIndex: 1, content_type: 'estatico' })
  })
})

// ── pendingChildWork ────────────────────────────────────────────────────────

describe('pendingChildWork', () => {
  const unwritten = { id: 'a', ai_written_at: null, copy: null }

  it('pieza sin redactar y sin job → necesita hijo', () => {
    expect(pendingChildWork([unwritten], [])).toEqual(['a'])
  })

  it('con job pending o processing → no', () => {
    expect(pendingChildWork([unwritten], [{ content_matrix_item_id: 'a', status: 'pending' }])).toEqual([])
    expect(pendingChildWork([unwritten], [{ content_matrix_item_id: 'a', status: 'processing' }])).toEqual([])
  })

  it('con job failed → no (no se reintenta solo)', () => {
    expect(pendingChildWork([unwritten], [{ content_matrix_item_id: 'a', status: 'failed' }])).toEqual([])
  })

  it('con job completed → no', () => {
    expect(pendingChildWork([unwritten], [{ content_matrix_item_id: 'a', status: 'completed' }])).toEqual([])
  })

  it('pieza ya redactada por la IA → no', () => {
    expect(pendingChildWork([{ id: 'a', ai_written_at: '2026-09-17T10:00:00Z', copy: null }], [])).toEqual([])
  })

  it('pieza con copy escrito a mano → no', () => {
    expect(pendingChildWork([{ id: 'a', ai_written_at: null, copy: 'Escrito a mano' }], [])).toEqual([])
    // Un copy de solo espacios sigue contando como vacío
    expect(pendingChildWork([{ id: 'a', ai_written_at: null, copy: '   ' }], [])).toEqual(['a'])
  })

  it('jobs de otras piezas o sin pieza no cuentan', () => {
    const items = [unwritten, { id: 'b', ai_written_at: null, copy: null }]
    const jobs = [{ content_matrix_item_id: 'b', status: 'pending' as const }, { content_matrix_item_id: null, status: 'pending' as const }]
    expect(pendingChildWork(items, jobs)).toEqual(['a'])
  })

  it('conserva el orden de entrada de las piezas', () => {
    const items = [
      { id: 'x', ai_written_at: null, copy: null },
      { id: 'y', ai_written_at: '2026-09-17T10:00:00Z', copy: null },
      { id: 'z', ai_written_at: null, copy: '' },
    ]
    expect(pendingChildWork(items, [])).toEqual(['x', 'z'])
  })
})

// ── briefOutcome ────────────────────────────────────────────────────────────

describe('briefOutcome', () => {
  it('respuesta truncada → truncada, aunque el brief traiga campos (no se escribe a medias)', () => {
    expect(briefOutcome('max_tokens', 0)).toBe('truncada')
    expect(briefOutcome('max_tokens', 3)).toBe('truncada')
  })

  it('sin truncar y sin campos usables → vacia (el runner reintenta)', () => {
    expect(briefOutcome('tool_use', 0)).toBe('vacia')
    expect(briefOutcome('end_turn', 0)).toBe('vacia')
    expect(briefOutcome(null, 0)).toBe('vacia')
  })

  it('sin truncar y con campos → escribir', () => {
    expect(briefOutcome('tool_use', 5)).toBe('escribir')
    expect(briefOutcome('end_turn', 1)).toBe('escribir')
  })
})
