'use server'

import { createClient } from '@/lib/supabase/server'
import { requireAdminOrSupervisor } from '@/lib/auth/require-user'
import type { WorkSession, WorkSessionBreak } from '@/types/db'

export interface ShiftDayRow {
  userId: string
  onlineSeconds: number
  breakSeconds: number
  productiveSeconds: number
  isActive: boolean
}

/**
 * Resuelve hasta qué punto extender una sesión "abierta" al calcular sus
 * métricas. Si la jornada del reporte ya terminó (día pasado), usamos el
 * fin del día; de lo contrario, "now". Esto evita que jornadas olvidadas
 * abiertas inflen los totales más allá del día consultado.
 */
function effectiveSessionEnd(s: WorkSession, now: Date, dayEnd: Date): Date {
  if (s.ended_at) return new Date(s.ended_at)
  return now < dayEnd ? now : dayEnd
}

function calcOnlineSeconds(s: WorkSession, now: Date, dayEnd: Date): number {
  if (s.total_seconds != null) return s.total_seconds
  const end = effectiveSessionEnd(s, now, dayEnd)
  const elapsed = Math.max(0, Math.round((end.getTime() - new Date(s.started_at).getTime()) / 1000))
  const breaksSec = sumBreakSeconds(s, end)
  return Math.max(0, elapsed - breaksSec)
}

function calcBreakSeconds(s: WorkSession, now: Date, dayEnd: Date): number {
  return sumBreakSeconds(s, effectiveSessionEnd(s, now, dayEnd))
}

function sumBreakSeconds(s: WorkSession, sessionEnd: Date): number {
  const breaks = (s.breaks_json ?? []) as WorkSessionBreak[]
  return breaks.reduce((sum, b) => {
    const start = new Date(b.started_at)
    if (start >= sessionEnd) return sum
    const rawEnd = b.ended_at ? new Date(b.ended_at) : sessionEnd
    const end = rawEnd > sessionEnd ? sessionEnd : rawEnd
    return sum + Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000))
  }, 0)
}

/**
 * Devuelve las jornadas del día `dateStr` (YYYY-MM-DD en GMT-6 / America/El_Salvador).
 * Acumula todas las sesiones del mismo usuario en una sola fila.
 *
 * El rango UTC equivalente a un día GMT-6 es:
 *   inicio: ${dateStr}T00:00:00-06:00
 *   fin:    ${dateStr}T23:59:59.999-06:00
 */
export async function fetchShiftsReportForDate(dateStr: string): Promise<ShiftDayRow[]> {
  await requireAdminOrSupervisor()
  // America/El_Salvador = UTC-6 sin DST
  const dayStartUTC = new Date(`${dateStr}T00:00:00-06:00`)
  const dayEndUTC = new Date(`${dateStr}T23:59:59.999-06:00`)

  const supabase = await createClient()

  const { data: sessions } = await supabase
    .from('work_sessions')
    .select('*')
    .gte('started_at', dayStartUTC.toISOString())
    .lte('started_at', dayEndUTC.toISOString())
    .order('started_at', { ascending: true })

  const list = (sessions ?? []) as WorkSession[]
  if (list.length === 0) return []

  const now = new Date()

  // Calcular productive_seconds SIEMPRE en vivo (no usar el snapshot de
  // work_sessions.productive_seconds, que queda stale si las entradas se
  // editan/agregan/borran después de cerrar la sesión).
  const userIds = [...new Set(list.map((s) => s.user_id))]
  const { data: entries } = await supabase
    .from('time_entries')
    .select('user_id, started_at, duration_seconds')
    .in('user_id', userIds)
    .not('ended_at', 'is', null)
    .gte('started_at', dayStartUTC.toISOString())
    .lte('started_at', dayEndUTC.toISOString())

  // Para cada sesión, suma duration_seconds de las entradas dentro de
  // [started_at, effectiveSessionEnd]. Esto refleja edits/inserts/deletes
  // posteriores al cierre.
  const liveProductive = new Map<string, number>()
  for (const s of list) {
    const sessionEnd = effectiveSessionEnd(s, now, dayEndUTC).toISOString()
    const total = (entries ?? [])
      .filter((e) => e.user_id === s.user_id && e.started_at >= s.started_at && e.started_at <= sessionEnd)
      .reduce((sum, e) => sum + ((e.duration_seconds as number | null) ?? 0), 0)
    liveProductive.set(s.id, total)
  }

  // Acumular por usuario (múltiples clock-in del mismo día = una sola fila)
  const agg = new Map<string, ShiftDayRow>()
  for (const s of list) {
    const row = agg.get(s.user_id) ?? {
      userId: s.user_id,
      onlineSeconds: 0,
      breakSeconds: 0,
      productiveSeconds: 0,
      isActive: false,
    }
    row.onlineSeconds += calcOnlineSeconds(s, now, dayEndUTC)
    row.breakSeconds += calcBreakSeconds(s, now, dayEndUTC)
    row.productiveSeconds += liveProductive.get(s.id) ?? 0
    row.isActive = row.isActive || !s.ended_at
    agg.set(s.user_id, row)
  }

  return [...agg.values()]
}
