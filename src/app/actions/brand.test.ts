import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Forma del payload que `updateBrandProfile` le entrega a `.upsert()`.
 *
 * Es una invariante, no un detalle: PostgREST solo escribe las columnas presentes en el objeto, y de
 * ahí depende que guardar un campo no borre los otros ocho. Un refactor que prerrellenara `row` con
 * la fila actual, o que pasara un **array** (con un array PostgREST manda `columns=` y el upsert
 * escribe también las columnas ausentes), borraría el resto del perfil en cada guardado y ninguna
 * prueba de dominio lo notaría.
 *
 * `vi.hoisted` porque `vi.mock` se iza por encima de los imports: el doble del cliente de Supabase
 * tiene que existir antes de que se evalúe `./brand`.
 */
const mock = vi.hoisted(() => {
  const USER_ID = '11111111-1111-4111-8111-111111111111'
  const CLIENT_ID = '22222222-2222-4222-8222-222222222222'
  const upsertCalls: Array<{ payload: unknown; options: unknown }> = []

  function createClient() {
    return {
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      from(table: string) {
        if (table === 'users') {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'admin' }, error: null }) }) }) }
        }
        if (table === 'client_brand_profiles') {
          return {
            upsert: (payload: unknown, options: unknown) => {
              upsertCalls.push({ payload, options })
              return {
                select: () => ({
                  single: async () => ({ data: { client_id: CLIENT_ID, ...(payload as object) }, error: null }),
                }),
              }
            },
          }
        }
        throw new Error(`El doble de Supabase no esperaba la tabla ${table}`)
      },
    }
  }

  return { USER_ID, CLIENT_ID, upsertCalls, createClient }
})

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mock.createClient() }))
vi.mock('./impersonation', () => ({ assertNotImpersonating: async () => {} }))

import { updateBrandProfile } from './brand'

describe('updateBrandProfile · forma del payload del upsert', () => {
  beforeEach(() => { mock.upsertCalls.length = 0 })

  it('entrega exactamente client_id, updated_by_user_id y el campo del parche', async () => {
    const r = await updateBrandProfile(mock.CLIENT_ID, { offerings: 'X' })

    expect(r.ok).toBe(true)
    expect(mock.upsertCalls).toHaveLength(1)
    const { payload, options } = mock.upsertCalls[0]
    expect(Array.isArray(payload)).toBe(false)
    expect(payload).toEqual({
      client_id: mock.CLIENT_ID,
      updated_by_user_id: mock.USER_ID,
      offerings: 'X',
    })
    expect(Object.keys(payload as object).sort()).toEqual(['client_id', 'offerings', 'updated_by_user_id'])
    expect(options).toEqual({ onConflict: 'client_id' })
  })

  it('un campo intacto no viaja; uno vaciado viaja como null', async () => {
    await updateBrandProfile(mock.CLIENT_ID, { tone: '   ', base_hashtags: ['  #fm  ', ''] })

    const { payload } = mock.upsertCalls[0]
    expect(Object.keys(payload as object).sort()).toEqual(
      ['base_hashtags', 'client_id', 'tone', 'updated_by_user_id'],
    )
    expect(payload).toMatchObject({ tone: null, base_hashtags: ['#fm'] })
  })

  it('un clientId que no es UUID no llega a la base', async () => {
    const r = await updateBrandProfile('no-soy-un-uuid', { offerings: 'X' })

    expect(r).toEqual({ ok: false, error: 'Datos inválidos.' })
    expect(mock.upsertCalls).toHaveLength(0)
  })
})
