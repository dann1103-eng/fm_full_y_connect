import { describe, it, expect } from 'vitest'
import {
  applyItemMerges, compareTimestamps, isGenerationLive, maxUpdatedAt, mergePolledItem, mergePolledTopics,
  newestItem, sameTopics, timestampMicros, type FieldLocks,
} from './matrix-generation'
import type { ContentMatrixItem } from '@/types/db'

function row(id: string, extra: Partial<ContentMatrixItem> = {}): ContentMatrixItem {
  return {
    id, matrix_id: 'm1', content_type: 'estatico', title: `Pieza ${id}`, topic: null, objective: null,
    copy: null, script: null, visual_style: null, hashtags: null, cta: null, deadline: '2026-10-10',
    needs_production: false, status: 'planned', requirement_id: null, blocked_reason: null, converted_at: null,
    blocked_at: null, assigned_to: null, estimated_time_minutes: null, ai_written_at: null,
    created_at: '2026-09-17T10:00:00+00:00', updated_at: '2026-09-17T10:00:00+00:00',
    ...extra,
  }
}

const NO_LOCKS: FieldLocks = { stale: () => false, screen: () => false }
const locks = (l: { stale?: string[]; screen?: string[] }): FieldLocks => ({
  stale: (k) => (l.stale ?? []).includes(k),
  screen: (k) => (l.screen ?? []).includes(k),
})

describe('isGenerationLive', () => {
  it('vive mientras el padre planifica aunque todavía no haya hijos', () => {
    expect(isGenerationLive({ phase: 'planning', writingItemIds: [] })).toBe(true)
  })
  it('la señal son los hijos vivos, no la fase: una regeneración tras un padre fallido sigue viva', () => {
    expect(isGenerationLive({ phase: 'failed', writingItemIds: ['a'] })).toBe(true)
    expect(isGenerationLive({ phase: 'idle', writingItemIds: ['a'] })).toBe(true)
  })
  it('un padre fallido sin hijos vivos ya no se sondea', () => {
    expect(isGenerationLive({ phase: 'failed', writingItemIds: [] })).toBe(false)
    expect(isGenerationLive({ phase: 'writing', writingItemIds: [] })).toBe(false)
    expect(isGenerationLive({ phase: 'idle', writingItemIds: [] })).toBe(false)
  })
})

describe('marcas de tiempo', () => {
  it('distingue microsegundos dentro del mismo milisegundo', () => {
    expect(compareTimestamps('2026-09-17T10:00:00.123456+00:00', '2026-09-17T10:00:00.123455+00:00')).toBeGreaterThan(0)
  })
  it('compara bien fracciones de distinto largo (Postgres recorta los ceros finales)', () => {
    expect(compareTimestamps('2026-09-17T10:00:00.5+00:00', '2026-09-17T10:00:00.123456+00:00')).toBeGreaterThan(0)
    expect(compareTimestamps('2026-09-17T10:00:00+00:00', '2026-09-17T10:00:00.1+00:00')).toBeLessThan(0)
    expect(compareTimestamps('2026-09-17T10:00:00.1+00:00', '2026-09-17T10:00:00.100000+00:00')).toBe(0)
  })
  it('es indiferente a la forma de la zona', () => {
    expect(compareTimestamps('2026-09-17T10:00:00Z', '2026-09-17T10:00:00+00:00')).toBe(0)
    expect(compareTimestamps('2026-09-17T04:00:00-06:00', '2026-09-17T10:00:00+00:00')).toBe(0)
  })
  it('un valor ilegible cuenta como el más viejo', () => {
    expect(timestampMicros('ayer')).toBeNull()
    expect(compareTimestamps('ayer', '2026-09-17T10:00:00+00:00')).toBeLessThan(0)
  })
  it('maxUpdatedAt siembra la marca de agua con la fila más reciente', () => {
    expect(maxUpdatedAt([])).toBeNull()
    expect(maxUpdatedAt([
      row('a', { updated_at: '2026-09-17T10:00:00.5+00:00' }),
      row('b', { updated_at: '2026-09-17T10:00:00.123456+00:00' }),
    ])).toBe('2026-09-17T10:00:00.5+00:00')
  })
})

describe('mergePolledItem', () => {
  it('pieza desconocida: entra entera', () => {
    const polled = row('n', { copy: 'hola' })
    const m = mergePolledItem(polled, undefined, NO_LOCKS)
    expect(m.confirmed).toBe(polled)
    expect(m.screen.copy).toBe('hola')
  })

  it('pieza conocida más nueva: pantalla y confirmada toman lo del servidor', () => {
    const confirmed = row('a')
    const polled = row('a', { copy: 'de la IA', ai_written_at: '2026-09-17T10:01:00+00:00', updated_at: '2026-09-17T10:01:00+00:00' })
    const m = mergePolledItem(polled, confirmed, NO_LOCKS)
    expect(m.screen.copy).toBe('de la IA')
    expect(m.screen.ai_written_at).toBe('2026-09-17T10:01:00+00:00')
    expect(m.confirmed.copy).toBe('de la IA')
    expect(m.confirmed.updated_at).toBe('2026-09-17T10:01:00+00:00')
  })

  it('guardado en vuelo: la pantalla conserva lo escrito, la confirmada sí se actualiza (destino del rollback)', () => {
    // commitText ya soltó el borrador local: lo único que protege "lo que escribí" es este candado.
    const confirmed = row('a', { copy: 'viejo' })
    const polled = row('a', { copy: 'viejo', script: 'guion IA', updated_at: '2026-09-17T10:01:00+00:00' })
    const m = mergePolledItem(polled, confirmed, locks({ screen: ['copy'] }))
    expect('copy' in m.screen).toBe(false)
    expect(m.screen.script).toBe('guion IA')
    expect(m.confirmed.copy).toBe('viejo')
    expect(m.confirmed.script).toBe('guion IA')
  })

  it('campo tocado después de enviarse la consulta: ni pantalla ni confirmada', () => {
    // Una conversión terminó mientras volaba el sondeo: su estado no viaja con `updated_at` nuevo,
    // así que solo este candado evita que la fila vieja la deshaga.
    const confirmed = row('a', { status: 'converted', requirement_id: 'r1' })
    const polled = row('a', { status: 'planned', requirement_id: null, copy: 'IA', updated_at: '2026-09-17T10:01:00+00:00' })
    const m = mergePolledItem(polled, confirmed, locks({ stale: ['status', 'requirement_id'] }))
    expect('status' in m.screen).toBe(false)
    expect(m.confirmed.status).toBe('converted')
    expect(m.confirmed.requirement_id).toBe('r1')
    expect(m.screen.copy).toBe('IA')
  })

  it('fila del sondeo más vieja que la confirmada: nunca retrocede, manda la confirmada', () => {
    // El guardado de `copy` devolvió la fila entera (con el guion que la IA ya había escrito) y luego
    // llegó un sondeo que leyó antes. Aplicarlo revertiría el copy recién guardado.
    const confirmed = row('a', { copy: 'mío', script: 'guion IA', updated_at: '2026-09-17T10:02:00+00:00' })
    const polled = row('a', { copy: 'viejo', script: null, updated_at: '2026-09-17T10:01:00+00:00' })
    const m = mergePolledItem(polled, confirmed, NO_LOCKS)
    expect(m.screen.copy).toBe('mío')
    expect(m.screen.script).toBe('guion IA')
    expect(m.confirmed).toEqual(confirmed)
  })

  it('no toca las columnas inmutables', () => {
    const confirmed = row('a')
    const polled = row('a', { matrix_id: 'otra', created_at: '2020-01-01T00:00:00+00:00', updated_at: '2026-09-17T10:01:00+00:00' })
    const m = mergePolledItem(polled, confirmed, NO_LOCKS)
    expect(m.confirmed.matrix_id).toBe('m1')
    expect('matrix_id' in m.screen).toBe(false)
  })
})

describe('applyItemMerges', () => {
  it('sin cambios devuelve la misma lista (un sondeo sin novedades no re-renderiza)', () => {
    const list = [row('a', { assigned_to: ['u1'] })]
    const m = mergePolledItem(row('a', { assigned_to: ['u1'] }), list[0], NO_LOCKS)
    expect(applyItemMerges(list, [m])).toBe(list)
    expect(applyItemMerges(list, [])).toBe(list)
  })

  it('actualiza la conocida y agrega la desconocida', () => {
    const list = [row('a')]
    const merges = [
      mergePolledItem(row('a', { copy: 'IA', updated_at: '2026-09-17T10:01:00+00:00' }), list[0], NO_LOCKS),
      mergePolledItem(row('b', { title: 'Nueva' }), undefined, NO_LOCKS),
    ]
    const next = applyItemMerges(list, merges)
    expect(next).toHaveLength(2)
    expect(next[0].copy).toBe('IA')
    expect(next[1].title).toBe('Nueva')
  })

  it('respeta los campos bloqueados de la pieza en pantalla', () => {
    const list = [row('a', { copy: 'escribiendo' })]
    const m = mergePolledItem(row('a', { copy: 'viejo', updated_at: '2026-09-17T10:01:00+00:00' }), row('a', { copy: 'viejo' }), locks({ screen: ['copy'] }))
    expect(applyItemMerges(list, [m])[0].copy).toBe('escribiendo')
  })

  it('es idempotente: aplicar dos veces no duplica la pieza agregada', () => {
    const merges = [mergePolledItem(row('b'), undefined, NO_LOCKS)]
    const once = applyItemMerges([], merges)
    expect(applyItemMerges(once, merges)).toHaveLength(1)
  })
})

describe('newestItem', () => {
  it('se queda con la versión más nueva; empate, la primera', () => {
    const a = row('a', { copy: 'insert' })
    const b = row('a', { copy: 'sondeo', updated_at: '2026-09-17T10:01:00+00:00' })
    expect(newestItem(a, b)).toBe(b)
    expect(newestItem(b, a)).toBe(b)
    expect(newestItem(a, undefined)).toBe(a)
    expect(newestItem(a, row('a'))).toBe(a)
  })
})

describe('mergePolledTopics', () => {
  const confirmed = { topics_json: [{ name: 'Otoño' }], updated_at: '2026-09-17T10:02:00+00:00' }
  it('respuesta más nueva: mandan sus temas', () => {
    const r = mergePolledTopics({ topics: [{ name: 'IA 1' }, { name: 'IA 2' }], matrixUpdatedAt: '2026-09-17T10:03:00+00:00' }, confirmed)
    expect(r).toEqual({ topics: [{ name: 'IA 1' }, { name: 'IA 2' }], updatedAt: '2026-09-17T10:03:00+00:00' })
  })
  it('respuesta más vieja: mandan los confirmados (si no, el próximo cambio de temas borraría los de la IA)', () => {
    const r = mergePolledTopics({ topics: [], matrixUpdatedAt: '2026-09-17T10:01:00+00:00' }, confirmed)
    expect(r).toEqual({ topics: [{ name: 'Otoño' }], updatedAt: '2026-09-17T10:02:00+00:00' })
  })
  it('sin temas o sin versión en la respuesta: nada que fusionar', () => {
    expect(mergePolledTopics({ topics: null, matrixUpdatedAt: '2026-09-17T10:03:00+00:00' }, confirmed)).toBeNull()
    expect(mergePolledTopics({ topics: [], matrixUpdatedAt: null }, confirmed)).toBeNull()
  })
  it('sameTopics compara nombre y nota, en orden', () => {
    expect(sameTopics([{ name: 'a', note: 'x' }], [{ name: 'a', note: 'x' }])).toBe(true)
    expect(sameTopics([{ name: 'a' }], [{ name: 'a', note: undefined }])).toBe(true)
    expect(sameTopics([{ name: 'a' }], [{ name: 'a', note: 'x' }])).toBe(false)
    expect(sameTopics([{ name: 'a' }, { name: 'b' }], [{ name: 'b' }, { name: 'a' }])).toBe(false)
  })
})
