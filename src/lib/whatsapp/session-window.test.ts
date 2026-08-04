import { describe, it, expect } from 'vitest'
import { getSessionWindow, formatDuration, SESSION_WINDOW_MS } from './session-window'

const AT = (iso: string) => new Date(iso).getTime()

describe('getSessionWindow', () => {
  it('está abierta justo después de que el cliente escribe', () => {
    const w = getSessionWindow('2026-08-03T16:55:00Z', AT('2026-08-03T17:00:00Z'))
    expect(w.state).toBe('open')
    expect(w.msRemaining).toBeGreaterThan(0)
  })

  it('avisa cuando quedan menos de 2 horas', () => {
    const w = getSessionWindow('2026-08-03T16:55:00Z', AT('2026-08-04T15:30:00Z'))
    expect(w.state).toBe('closing')
  })

  it('reproduce el caso real: cerrada por 28 minutos', () => {
    // Verónica escribió 03-ago 16:55 UTC; staff respondió 04-ago 17:23 UTC.
    // Meta rechazó con 131047. La ventana había cerrado a las 16:55 del día 4.
    const w = getSessionWindow('2026-08-03T16:55:26Z', AT('2026-08-04T17:23:28Z'))
    expect(w.state).toBe('closed')
    expect(w.msRemaining).toBe(0)
    expect(w.closesAt?.toISOString()).toBe('2026-08-04T16:55:26.000Z')
  })

  it('sigue abierta en el último minuto antes de las 24h', () => {
    const w = getSessionWindow('2026-08-03T16:55:00Z', AT('2026-08-04T16:54:00Z'))
    expect(w.state).toBe('closing')
    expect(w.msRemaining).toBeGreaterThan(0)
  })

  it('cierra exactamente al cumplirse las 24h', () => {
    const last = '2026-08-03T16:55:00Z'
    const w = getSessionWindow(last, AT(last) + SESSION_WINDOW_MS)
    expect(w.state).toBe('closed')
  })

  it('sin mensajes entrantes devuelve "never"', () => {
    expect(getSessionWindow(null, AT('2026-08-04T00:00:00Z')).state).toBe('never')
    expect(getSessionWindow(undefined, AT('2026-08-04T00:00:00Z')).state).toBe('never')
  })

  it('una fecha inválida no rompe el chat', () => {
    expect(getSessionWindow('no-es-fecha', AT('2026-08-04T00:00:00Z')).state).toBe('never')
  })

  it('acepta Date además de string', () => {
    const w = getSessionWindow(new Date('2026-08-03T16:55:00Z'), AT('2026-08-03T17:00:00Z'))
    expect(w.state).toBe('open')
  })
})

describe('formatDuration', () => {
  it('formatea horas y minutos en español', () => {
    expect(formatDuration(2 * 60 * 60 * 1000 + 15 * 60 * 1000)).toBe('2 h 15 min')
    expect(formatDuration(43 * 60 * 1000)).toBe('43 min')
    expect(formatDuration(3 * 60 * 60 * 1000)).toBe('3 h')
  })

  it('maneja los extremos', () => {
    expect(formatDuration(30 * 1000)).toBe('menos de 1 min')
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(-5000)).toBe('0 min')
  })
})
