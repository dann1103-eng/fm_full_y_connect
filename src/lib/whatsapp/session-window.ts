/**
 * Ventana de servicio de 24h de WhatsApp.
 *
 * Meta solo permite mensajes de TEXTO LIBRE dentro de las 24h siguientes al
 * último mensaje del cliente. Fuera de esa ventana el envío se rechaza con el
 * error 131047 ("Re-engagement message") y la única vía es una plantilla
 * aprobada.
 *
 * Esto existe porque el inbox dejaba redactar y enviar mensajes condenados: el
 * staff solo se enteraba cuando ya habían fallado, y en un caso real se perdió
 * la respuesta a un lead por 28 minutos.
 */

export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000
/** Umbral para avisar que la ventana está por cerrarse. */
export const CLOSING_SOON_MS = 2 * 60 * 60 * 1000

export type SessionWindowState =
  /** Se puede escribir con normalidad. */
  | 'open'
  /** Abierta pero quedan menos de CLOSING_SOON_MS. */
  | 'closing'
  /** Pasaron más de 24h desde el último mensaje del cliente. */
  | 'closed'
  /** El cliente nunca ha escrito: solo plantillas. */
  | 'never'

export interface SessionWindow {
  state: SessionWindowState
  /** Momento en que se cierra (null si el cliente nunca escribió). */
  closesAt: Date | null
  /** Milisegundos restantes; 0 si ya cerró o nunca hubo entrante. */
  msRemaining: number
}

export function getSessionWindow(
  lastInboundAt: string | Date | null | undefined,
  nowMs: number,
): SessionWindow {
  if (!lastInboundAt) return { state: 'never', closesAt: null, msRemaining: 0 }

  const lastMs = lastInboundAt instanceof Date
    ? lastInboundAt.getTime()
    : new Date(lastInboundAt).getTime()
  if (Number.isNaN(lastMs)) return { state: 'never', closesAt: null, msRemaining: 0 }

  const closesAtMs = lastMs + SESSION_WINDOW_MS
  const msRemaining = closesAtMs - nowMs
  const closesAt = new Date(closesAtMs)

  if (msRemaining <= 0) return { state: 'closed', closesAt, msRemaining: 0 }
  if (msRemaining <= CLOSING_SOON_MS) return { state: 'closing', closesAt, msRemaining }
  return { state: 'open', closesAt, msRemaining }
}

/** "2 h 15 min", "43 min", "menos de 1 min" — para mostrarle al staff. */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0 min'
  const totalMin = Math.floor(ms / 60_000)
  if (totalMin < 1) return 'menos de 1 min'
  const h = Math.floor(totalMin / 60)
  const min = totalMin % 60
  if (h === 0) return `${min} min`
  if (min === 0) return `${h} h`
  return `${h} h ${min} min`
}
