'use server'

import { createClient } from '@/lib/supabase/server'
import { canViewReports } from '@/lib/domain/permissions'
import {
  buildCycleRows,
  buildCycleAggregates,
  type RequirementInput,
  type RequirementCycleRow,
  type CycleAggregates,
} from '@/lib/domain/requirementCycle'
import type { ContentType, Phase, RequirementPhaseLog } from '@/types/db'

interface Params {
  startIso?: string
  endIso?: string
  clientId?: string
  requirementId?: string
}

interface Result {
  rows?: RequirementCycleRow[]
  aggregates?: CycleAggregates
  error?: string
}

type RawRequirement = {
  id: string
  title: string | null
  content_type: ContentType
  phase: Phase
  registered_at: string
  billing_cycles: {
    client_id: string
    clients: { id: string; name: string } | null
  } | null
}

export async function fetchRequirementCycleStats(params: Params): Promise<Result> {
  try {
    const supabase = await createClient()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) return { error: 'No autenticado' }

    const { data: authRow } = await supabase
      .from('users')
      .select('role')
      .eq('id', authUser.id)
      .single()
    if (!canViewReports(authRow?.role)) return { error: 'Sin permisos' }

    let reqQuery = supabase
      .from('requirements')
      .select(`
        id, title, content_type, phase, registered_at,
        billing_cycles ( client_id, clients ( id, name ) )
      `)
      .eq('voided', false)

    if (params.startIso) reqQuery = reqQuery.gte('registered_at', params.startIso)
    if (params.endIso) reqQuery = reqQuery.lt('registered_at', params.endIso)
    if (params.requirementId) reqQuery = reqQuery.eq('id', params.requirementId)

    const { data: reqRaw, error: reqErr } = await reqQuery
    if (reqErr) {
      console.error('fetchRequirementCycleStats requirements query error:', reqErr)
      return { error: reqErr.message }
    }

    let reqs = (reqRaw ?? []) as unknown as RawRequirement[]
    if (params.clientId) {
      reqs = reqs.filter((r) => r.billing_cycles?.client_id === params.clientId)
    }

    if (reqs.length === 0) {
      return { rows: [], aggregates: buildCycleAggregates([]) }
    }

    const reqIds = reqs.map((r) => r.id)

    const [logsRes, entriesRes] = await Promise.all([
      supabase
        .from('requirement_phase_logs')
        .select('*')
        .in('requirement_id', reqIds)
        .order('created_at', { ascending: true }),
      supabase
        .from('time_entries')
        .select('requirement_id, started_at')
        .in('requirement_id', reqIds)
        .eq('entry_type', 'requirement')
        .order('started_at', { ascending: true }),
    ])

    if (logsRes.error) {
      console.error('phase_logs query error:', logsRes.error)
      return { error: logsRes.error.message }
    }
    if (entriesRes.error) {
      console.error('time_entries query error:', entriesRes.error)
      return { error: entriesRes.error.message }
    }

    const logsByReq: Record<string, RequirementPhaseLog[]> = {}
    for (const log of (logsRes.data ?? []) as RequirementPhaseLog[]) {
      const list = logsByReq[log.requirement_id] ?? []
      list.push(log)
      logsByReq[log.requirement_id] = list
    }

    const firstEntryByReq: Record<string, string> = {}
    for (const e of entriesRes.data ?? []) {
      if (!e.requirement_id) continue
      if (!firstEntryByReq[e.requirement_id]) {
        firstEntryByReq[e.requirement_id] = e.started_at
      }
    }

    const inputs: RequirementInput[] = reqs.map((r) => ({
      id: r.id,
      title: r.title,
      client_id: r.billing_cycles?.client_id ?? null,
      client_name: r.billing_cycles?.clients?.name ?? 'Interno FM',
      content_type: r.content_type,
      phase: r.phase,
      registered_at: r.registered_at,
    }))

    const nowIso = new Date().toISOString()
    const rows = buildCycleRows(inputs, logsByReq, firstEntryByReq, nowIso)
    const aggregates = buildCycleAggregates(rows)

    return { rows, aggregates }
  } catch (e) {
    console.error('fetchRequirementCycleStats failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}
