import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkSession } from '@/types/db'

// Mock del server action ANTES de importar el store (vi.hoisted evita el TDZ).
const { getMyActiveShift } = vi.hoisted(() => ({ getMyActiveShift: vi.fn() }))
vi.mock('@/app/actions/work-sessions', () => ({ getMyActiveShift }))

import {
  refreshActiveShift,
  notifyShiftChanged,
  peekActiveShift,
  subscribe,
} from './useActiveShift'

function makeShift(overrides: Partial<WorkSession> = {}): WorkSession {
  return {
    id: 'ws-1',
    user_id: 'u-1',
    started_at: '2026-07-06T10:00:00.000Z',
    ended_at: null,
    status: 'active',
    breaks_json: [],
    ...overrides,
  } as unknown as WorkSession
}

const flush = () => Promise.resolve().then(() => Promise.resolve())

describe('useActiveShift — store compartido de jornada', () => {
  beforeEach(() => {
    getMyActiveShift.mockReset()
  })

  it('refreshActiveShift carga la jornada desde el server action', async () => {
    getMyActiveShift.mockResolvedValue(makeShift())
    await refreshActiveShift()
    expect(peekActiveShift().shift?.id).toBe('ws-1')
    expect(peekActiveShift().loading).toBe(false)
  })

  it('dedupe: dos refresh con la MISMA jornada conservan la referencia del snapshot', async () => {
    getMyActiveShift.mockResolvedValue(makeShift())
    await refreshActiveShift()
    const a = peekActiveShift()
    getMyActiveShift.mockResolvedValue(makeShift()) // firma equivalente
    await refreshActiveShift()
    const b = peekActiveShift()
    // Referencia estable → useSyncExternalStore no re-renderiza sin cambios.
    expect(Object.is(a, b)).toBe(true)
  })

  it('finalizar la jornada (null) actualiza el snapshot', async () => {
    getMyActiveShift.mockResolvedValue(makeShift())
    await refreshActiveShift()
    const before = peekActiveShift()
    getMyActiveShift.mockResolvedValue(null)
    await refreshActiveShift()
    const after = peekActiveShift()
    expect(Object.is(before, after)).toBe(false)
    expect(after.shift).toBeNull()
  })

  it('un cambio de status (p. ej. iniciar pausa) actualiza el snapshot', async () => {
    getMyActiveShift.mockResolvedValue(makeShift({ status: 'active' }))
    await refreshActiveShift()
    getMyActiveShift.mockResolvedValue(makeShift({ status: 'on_lunch' }))
    await refreshActiveShift()
    expect(peekActiveShift().shift?.status).toBe('on_lunch')
  })

  it('fan-out: un solo refresh notifica a TODOS los suscriptores (el fix)', async () => {
    getMyActiveShift.mockResolvedValue(makeShift({ id: 'ws-fan' }))
    const a = vi.fn()
    const b = vi.fn()
    const unsubA = subscribe(a) // primer suscriptor arranca la sync interna
    const unsubB = subscribe(b)
    await flush()
    a.mockClear()
    b.mockClear()
    getMyActiveShift.mockResolvedValue(makeShift({ id: 'ws-fan-2' }))
    await refreshActiveShift()
    expect(a).toHaveBeenCalled()
    expect(b).toHaveBeenCalled()
    unsubA()
    unsubB()
  })

  it('notifyShiftChanged dispara un refetch', async () => {
    getMyActiveShift.mockResolvedValue(makeShift())
    notifyShiftChanged()
    await flush()
    expect(getMyActiveShift).toHaveBeenCalled()
  })
})
