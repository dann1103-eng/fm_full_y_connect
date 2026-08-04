import { describe, it, expect } from 'vitest'
import {
  getSessionWindow,
  formatDuration,
  windowAlertBucketMs,
  windowAlertBucketLabel,
  SESSION_WINDOW_MS,
} from './session-window'

const H = (n: number) => n * 60 * 60 * 1000
const MIN = (n: number) => n * 60 * 1000

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

describe('windowAlertBucketMs', () => {
  it('no avisa cuando todavía falta más de 12 h', () => {
    expect(windowAlertBucketMs(H(13))).toBeNull()
    expect(windowAlertBucketMs(H(23))).toBeNull()
  })

  it('avisa desde las 12 h y escala al acercarse el cierre', () => {
    expect(windowAlertBucketMs(H(11))).toBe(H(12))
    expect(windowAlertBucketMs(H(5))).toBe(H(6))
    expect(windowAlertBucketMs(H(1))).toBe(H(2))
    expect(windowAlertBucketMs(MIN(20))).toBe(MIN(30))
  })

  it('incluye el límite exacto de cada escalón', () => {
    expect(windowAlertBucketMs(H(12))).toBe(H(12))
    expect(windowAlertBucketMs(H(6))).toBe(H(6))
    expect(windowAlertBucketMs(MIN(30))).toBe(MIN(30))
  })

  it('deja de avisar cuando la ventana ya cerró', () => {
    // Ya no hay nada que hacer con texto libre: avisar solo sería ruido.
    expect(windowAlertBucketMs(0)).toBeNull()
    expect(windowAlertBucketMs(-1000)).toBeNull()
  })

  it('el escalón cambia al cruzar un umbral, para que la alerta vuelva a sonar', () => {
    // Es lo que hace que "no pare de joder": el id de la notificación incluye
    // el escalón, así que al pasar de 12h a 6h se emite una alerta nueva.
    expect(windowAlertBucketMs(H(7))).not.toBe(windowAlertBucketMs(H(5)))
  })
})

describe('windowAlertBucketLabel', () => {
  it('etiqueta horas y minutos', () => {
    expect(windowAlertBucketLabel(H(12))).toBe('12h')
    expect(windowAlertBucketLabel(H(2))).toBe('2h')
    expect(windowAlertBucketLabel(MIN(30))).toBe('30m')
  })
})
