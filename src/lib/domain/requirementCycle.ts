import type { Phase, ContentType, RequirementPhaseLog } from '@/types/db'
import { PHASES } from '@/lib/domain/pipeline'

export interface PhaseTime {
  standby_seconds: number
  worked_seconds: number
  total_seconds: number
}

export interface RequirementCycleRow {
  requirement_id: string
  requirement_title: string
  client_id: string | null
  client_name: string
  content_type: ContentType | null
  current_phase: Phase
  registered_at: string
  phases: Partial<Record<Phase, PhaseTime>>
  first_move_seconds: number | null
  first_work_seconds: number | null
  total_cycle_seconds: number | null
  is_closed: boolean
}

export interface CycleAggregates {
  avg_first_move_seconds: number | null
  avg_first_work_seconds: number | null
  avg_total_cycle_seconds: number | null
  by_type: Partial<Record<ContentType, { count: number; avg_cycle: number | null; avg_first_move: number | null }>>
  by_phase: Partial<Record<Phase, { avg_standby: number; avg_worked: number; count: number }>>
  count_total: number
  count_closed: number
}

export interface RequirementInput {
  id: string
  title: string | null
  client_id: string | null
  client_name: string
  content_type: ContentType | null
  phase: Phase
  registered_at: string
}

export interface TimeEntryStart {
  requirement_id: string
  started_at: string
}

function diffSeconds(fromIso: string, toIso: string): number {
  return Math.max(0, Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000))
}

/**
 * Compute per-requirement cycle metrics from phase logs + first time_entry timestamps.
 *
 * - phases[phase] = { standby, worked, total } summed across all passes through that phase.
 *   For the log that is still open (ended_at=null) we treat standby/worked as already-persisted
 *   values on the row (the mover updates them when leaving the phase). If worked/standby are
 *   null we derive total duration from created_at → now and put it all in standby.
 * - first_move_seconds: created_at → created_at of the first log whose from_phase='pendiente'.
 * - first_work_seconds: created_at → min(started_at) of time_entries for the requirement.
 * - total_cycle_seconds: created_at → created_at of the log whose to_phase='publicado_entregado'.
 *   (When reached, is_closed=true.)
 */
export function buildCycleRows(
  requirements: RequirementInput[],
  logsByReq: Record<string, RequirementPhaseLog[]>,
  firstEntryByReq: Record<string, string>,
  nowIso: string,
): RequirementCycleRow[] {
  const rows: RequirementCycleRow[] = []

  for (const r of requirements) {
    const logs = [...(logsByReq[r.id] ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))
    const phases: Partial<Record<Phase, PhaseTime>> = {}

    for (const log of logs) {
      const phase = log.to_phase as Phase
      const current = phases[phase] ?? { standby_seconds: 0, worked_seconds: 0, total_seconds: 0 }
      const standby = log.standby_seconds ?? 0
      const worked = log.worked_seconds ?? 0

      if (log.ended_at == null && standby === 0 && worked === 0) {
        // Open log with no persisted split → use wall-clock time as standby
        const elapsed = diffSeconds(log.created_at, nowIso)
        current.standby_seconds += elapsed
        current.total_seconds += elapsed
      } else {
        current.standby_seconds += standby
        current.worked_seconds += worked
        current.total_seconds += standby + worked
      }

      phases[phase] = current
    }

    let firstMove: number | null = null
    const firstMoveLog = logs.find((l) => l.from_phase === 'pendiente')
    if (firstMoveLog) firstMove = diffSeconds(r.registered_at, firstMoveLog.created_at)

    let firstWork: number | null = null
    const firstEntryIso = firstEntryByReq[r.id]
    if (firstEntryIso) firstWork = diffSeconds(r.registered_at, firstEntryIso)

    let totalCycle: number | null = null
    const closedLog = logs.find((l) => l.to_phase === 'publicado_entregado')
    const isClosed = Boolean(closedLog) || r.phase === 'publicado_entregado'
    if (closedLog) totalCycle = diffSeconds(r.registered_at, closedLog.created_at)
    else if (r.phase === 'publicado_entregado') totalCycle = diffSeconds(r.registered_at, nowIso)

    rows.push({
      requirement_id: r.id,
      requirement_title: r.title || '— Sin título —',
      client_id: r.client_id,
      client_name: r.client_name,
      content_type: r.content_type,
      current_phase: r.phase,
      registered_at: r.registered_at,
      phases,
      first_move_seconds: firstMove,
      first_work_seconds: firstWork,
      total_cycle_seconds: totalCycle,
      is_closed: isClosed,
    })
  }

  return rows
}

function avg(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number')
  if (nums.length === 0) return null
  return nums.reduce((s, v) => s + v, 0) / nums.length
}

export function buildCycleAggregates(rows: RequirementCycleRow[]): CycleAggregates {
  const closed = rows.filter((r) => r.is_closed)

  const by_type: CycleAggregates['by_type'] = {}
  const typeGroups = new Map<ContentType, RequirementCycleRow[]>()
  for (const r of rows) {
    if (!r.content_type) continue
    const list = typeGroups.get(r.content_type) ?? []
    list.push(r)
    typeGroups.set(r.content_type, list)
  }
  for (const [type, list] of typeGroups) {
    by_type[type] = {
      count: list.length,
      avg_cycle: avg(list.map((r) => r.total_cycle_seconds)),
      avg_first_move: avg(list.map((r) => r.first_move_seconds)),
    }
  }

  const by_phase: CycleAggregates['by_phase'] = {}
  for (const phase of PHASES) {
    const withPhase = rows.filter((r) => r.phases[phase])
    if (withPhase.length === 0) continue
    by_phase[phase] = {
      count: withPhase.length,
      avg_standby: avg(withPhase.map((r) => r.phases[phase]!.standby_seconds)) ?? 0,
      avg_worked: avg(withPhase.map((r) => r.phases[phase]!.worked_seconds)) ?? 0,
    }
  }

  return {
    avg_first_move_seconds: avg(rows.map((r) => r.first_move_seconds)),
    avg_first_work_seconds: avg(rows.map((r) => r.first_work_seconds)),
    avg_total_cycle_seconds: avg(closed.map((r) => r.total_cycle_seconds)),
    by_type,
    by_phase,
    count_total: rows.length,
    count_closed: closed.length,
  }
}
