import type { AdminCategory, TimeEntry, WorkSession } from '@/types/db'

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function formatDurationHMS(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return [h, m, ss].map(n => n.toString().padStart(2, '0')).join(':')
}

/** Zona horaria oficial de la operación. Todas las conversiones de display la usan. */
export const APP_TZ = 'America/El_Salvador' // GMT-6, sin DST

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('es-SV', {
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: APP_TZ,
  }).format(new Date(iso))
}

export function formatDayLabel(iso: string): string {
  return new Intl.DateTimeFormat('es-SV', {
    weekday: 'short', day: 'numeric', month: 'short',
    timeZone: APP_TZ,
  }).format(new Date(iso))
}

/**
 * Retorna la fecha local (YYYY-MM-DD) de un Date en la zona GMT-6.
 * Usar SIEMPRE en lugar de toISOString().split('T')[0] que retorna UTC.
 */
export function isoDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ }).format(d)
}

export const ADMIN_CATEGORY_LABELS: Record<AdminCategory, string> = {
  administrativa:         'Administrativa',
  coordinacion_cuentas:   'Coordinación de Cuentas',
  reunion_interna:        'Reunión Interna',
  direccion_creativa:     'Dirección Creativa',
  direccion_comunicacion: 'Dirección de Comunicación',
  standby:                'Tiempo de Standby',
}

export const ADMIN_CATEGORIES: AdminCategory[] = [
  'administrativa',
  'coordinacion_cuentas',
  'reunion_interna',
  'direccion_creativa',
  'direccion_comunicacion',
  'standby',
]

// ── Resumen de tiempo (tarjetas en /tiempo) ────────────────────────────────

export interface TimeSummary {
  /** Tiempo online: suma de work_sessions.total_seconds en el rango (excluye almuerzo + away). */
  onlineSeconds: number
  /** Tiempo productivo: suma total de duration_seconds de las time_entries del rango. */
  productiveSeconds: number
  /** Tiempo en standby: suma de duration_seconds de entries con category='standby'. */
  standbySeconds: number
  /** Tiempo efectivo: productivo - standby. */
  effectiveSeconds: number
  /** % productivo / online (capeado a 100, null si online == 0). */
  productivityPercent: number | null
}

type TimeEntryForSummary = Pick<TimeEntry, 'duration_seconds' | 'entry_type' | 'category'>
type WorkSessionForSummary = Pick<WorkSession, 'started_at' | 'ended_at' | 'breaks_json' | 'total_seconds'>

/**
 * Calcula segundos de una pausa cerrada. Las pausas abiertas no se cuentan
 * (todavía está en almuerzo / away al momento del cálculo, pero todavía está
 * contando contra el total).
 */
function closedBreakSeconds(b: { started_at: string; ended_at?: string }): number {
  if (!b.ended_at) return 0
  const ms = new Date(b.ended_at).getTime() - new Date(b.started_at).getTime()
  return Math.max(0, Math.floor(ms / 1000))
}

/** Tiempo online de una sola work_session. Para cerradas usa total_seconds. */
function sessionOnlineSeconds(ws: WorkSessionForSummary, nowMs: number): number {
  if (ws.total_seconds != null && ws.ended_at) return ws.total_seconds
  // Sesión abierta: (ahora - started_at) - sumatoria de pausas cerradas
  const elapsed = Math.max(0, Math.floor((nowMs - new Date(ws.started_at).getTime()) / 1000))
  const breakTotal = (ws.breaks_json ?? []).reduce((acc, b) => acc + closedBreakSeconds(b), 0)
  return Math.max(0, elapsed - breakTotal)
}

export function computeTimeSummary(
  entries: TimeEntryForSummary[],
  workSessions: WorkSessionForSummary[],
  nowMs: number = new Date().getTime(),
): TimeSummary {
  const onlineSeconds = workSessions.reduce((acc, ws) => acc + sessionOnlineSeconds(ws, nowMs), 0)

  let productiveSeconds = 0
  let standbySeconds = 0
  for (const e of entries) {
    const d = e.duration_seconds ?? 0
    productiveSeconds += d
    if (e.entry_type === 'administrative' && e.category === 'standby') {
      standbySeconds += d
    }
  }

  const effectiveSeconds = Math.max(0, productiveSeconds - standbySeconds)
  const productivityPercent = onlineSeconds > 0
    ? Math.min(100, Math.round((productiveSeconds / onlineSeconds) * 100))
    : null

  return { onlineSeconds, productiveSeconds, standbySeconds, effectiveSeconds, productivityPercent }
}

/**
 * Formato de header de día para el selector. Devuelve "Hoy", "Ayer" o
 * "Mié 7 May 2026" según el día relativo a hoy.
 */
export function formatDayHeader(date: Date): string {
  const today = new Date()
  const dStr = isoDateStr(date)
  const todayStr = isoDateStr(today)
  if (dStr === todayStr) return 'Hoy'
  const yest = new Date(today)
  yest.setDate(yest.getDate() - 1)
  if (dStr === isoDateStr(yest)) return 'Ayer'
  return new Intl.DateTimeFormat('es-SV', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    timeZone: APP_TZ,
  }).format(date)
}
