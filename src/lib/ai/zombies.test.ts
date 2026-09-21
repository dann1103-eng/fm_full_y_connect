import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  EXHAUSTED_ZOMBIE_AGE_MS, EXHAUSTED_ZOMBIE_ERROR, EXHAUSTED_ZOMBIE_SCAN_LIMIT, exhaustedZombieIds, sweepExhaustedZombies,
} from './zombies'

describe('exhaustedZombieIds', () => {
  it('solo los que agotaron sus intentos: los demás los rescata el watchdog de 0124', () => {
    expect(exhaustedZombieIds([
      { id: 'a', attempts: 3, max_attempts: 3 },
      { id: 'b', attempts: 2, max_attempts: 3 },
      { id: 'c', attempts: 4, max_attempts: 3 },
      { id: 'd', attempts: 1, max_attempts: 1 },
    ])).toEqual(['a', 'c', 'd'])
  })

  it('sin candidatos → nada', () => {
    expect(exhaustedZombieIds([])).toEqual([])
  })
})

// ── Cliente falso: registra la cadena de cada consulta y devuelve el resultado encolado para esa tabla ──

type Call = { table: string; chain: Array<[string, ...unknown[]]> }
type Result = { data: unknown; error: { message: string } | null }

function fakeClient(results: Record<string, Array<Result | Error>>) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const call: Call = { table, chain: [] }
      calls.push(call)
      const next = results[table]?.shift() ?? { data: null, error: null }
      const builder: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'lt', 'order', 'limit', 'in', 'update', 'insert']) {
        builder[m] = (...args: unknown[]) => {
          call.chain.push([m, ...args])
          return builder
        }
      }
      builder.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
        (next instanceof Error ? Promise.reject(next) : Promise.resolve(next)).then(resolve, reject)
      return builder
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

const NOW = new Date('2026-09-20T12:00:00.000Z')
const CUTOFF = new Date(NOW.getTime() - EXHAUSTED_ZOMBIE_AGE_MS).toISOString()

describe('sweepExhaustedZombies', () => {
  it('lee acotado y marca failed solo los agotados, sin pisar una terminación concurrente', async () => {
    const { client, calls } = fakeClient({
      ai_jobs: [
        { data: [{ id: 'a', attempts: 3, max_attempts: 3 }, { id: 'b', attempts: 1, max_attempts: 3 }], error: null },
        { data: [{ id: 'a' }], error: null },
      ],
      ai_job_events: [{ data: null, error: null }],
    })
    const swept = await sweepExhaustedZombies(client, NOW)
    expect(swept).toEqual(['a'])

    const [select, update, events] = calls
    expect(select.table).toBe('ai_jobs')
    expect(select.chain).toContainEqual(['eq', 'status', 'processing'])
    expect(select.chain).toContainEqual(['lt', 'locked_at', CUTOFF])
    expect(select.chain).toContainEqual(['limit', EXHAUSTED_ZOMBIE_SCAN_LIMIT])

    expect(update.table).toBe('ai_jobs')
    expect(update.chain[0]).toEqual(['update', {
      status: 'failed',
      finished_at: NOW.toISOString(),
      locked_at: null,
      locked_by: null,
      error_text: EXHAUSTED_ZOMBIE_ERROR,
    }])
    expect(update.chain).toContainEqual(['in', 'id', ['a']])
    // La guarda contra la carrera: un job que terminó entre la lectura y el update no se toca.
    expect(update.chain).toContainEqual(['eq', 'status', 'processing'])

    expect(events.table).toBe('ai_job_events')
    expect(events.chain[0][0]).toBe('insert')
  })

  it('sin agotados no escribe nada', async () => {
    const { client, calls } = fakeClient({
      ai_jobs: [{ data: [{ id: 'b', attempts: 1, max_attempts: 3 }], error: null }],
    })
    expect(await sweepExhaustedZombies(client, NOW)).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('un update que no afectó filas (otro proceso lo terminó) no registra eventos', async () => {
    const { client, calls } = fakeClient({
      ai_jobs: [
        { data: [{ id: 'a', attempts: 3, max_attempts: 3 }], error: null },
        { data: [], error: null },
      ],
    })
    expect(await sweepExhaustedZombies(client, NOW)).toEqual([])
    expect(calls.map((c) => c.table)).toEqual(['ai_jobs', 'ai_jobs'])
  })

  it('nunca lanza: un error de lectura, de update o una excepción se loguean y se sigue', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const readError = fakeClient({ ai_jobs: [{ data: null, error: { message: 'boom' } }] })
      await expect(sweepExhaustedZombies(readError.client, NOW)).resolves.toEqual([])

      const updateError = fakeClient({
        ai_jobs: [
          { data: [{ id: 'a', attempts: 3, max_attempts: 3 }], error: null },
          { data: null, error: { message: 'boom' } },
        ],
      })
      await expect(sweepExhaustedZombies(updateError.client, NOW)).resolves.toEqual([])

      const thrown = fakeClient({ ai_jobs: [new Error('red caída')] })
      await expect(sweepExhaustedZombies(thrown.client, NOW)).resolves.toEqual([])

      expect(spy).toHaveBeenCalledTimes(3)
    } finally {
      spy.mockRestore()
    }
  })
})
