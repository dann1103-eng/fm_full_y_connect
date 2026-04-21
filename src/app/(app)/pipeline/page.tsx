import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { PipelineContainer } from '@/components/pipeline/PipelineContainer'
import { PIPELINE_CONTENT_TYPES } from '@/lib/domain/pipeline'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, RequirementPhaseLog, Client } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function PipelinePage() {
  const supabase = await createClient()

  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) return null

  const { data: appUser } = await supabase.from('users').select('role').eq('id', authUser.id).single()
  const role = appUser?.role ?? 'operator'
  const isAdmin = role === 'admin'
  const canAssign = role === 'admin' || role === 'supervisor'
  const isOperator = role === 'operator'

  // 1. Active cycles
  const { data: currentCycles } = await supabase
    .from('billing_cycles')
    .select('id, client_id')
    .eq('status', 'current')

  const currentCycleIds = (currentCycles ?? []).map(c => c.id)

  const items: PipelineItem[] = []
  const logsMap: Record<string, RequirementPhaseLog[]> = {}

  if (currentCycleIds.length > 0) {
    let reqQuery = supabase
      .from('requirements')
      .select('id, content_type, phase, carried_over, billing_cycle_id, registered_at, notes, title, cambios_count, review_started_at, priority, estimated_time_minutes, assigned_to, includes_story, deadline')
      .eq('voided', false)
      .in('content_type', PIPELINE_CONTENT_TYPES)
      .in('billing_cycle_id', currentCycleIds)
      .order('registered_at', { ascending: false })
      .limit(200)

    if (isOperator) {
      reqQuery = reqQuery.contains('assigned_to', [authUser.id])
    }

    const { data: requirementsRaw } = await reqQuery

    const cycleClientMap: Record<string, string> = {}
    for (const c of currentCycles ?? []) cycleClientMap[c.id] = c.client_id

    const uniqueClientIds = [...new Set(Object.values(cycleClientMap))]
    const { data: clientsRaw } = await supabase
      .from('clients')
      .select('id, name, logo_url')
      .in('id', uniqueClientIds)

    const clientMap: Record<string, Pick<Client, 'id' | 'name' | 'logo_url'>> = {}
    for (const cl of clientsRaw ?? []) clientMap[cl.id] = cl

    const { data: usersRaw } = await supabase.from('users').select('id, full_name, avatar_url')
    const usersMap: Record<string, { name: string; avatar_url: string | null }> = {}
    for (const u of usersRaw ?? []) usersMap[u.id] = { name: u.full_name, avatar_url: u.avatar_url }

    for (const c of requirementsRaw ?? []) {
      const cClientId = cycleClientMap[c.billing_cycle_id]
      const cl = clientMap[cClientId]
      if (!cl) continue

      items.push({
        id: c.id,
        content_type: c.content_type,
        phase: c.phase,
        billing_cycle_id: c.billing_cycle_id,
        client_id: cl.id,
        client_name: cl.name,
        client_logo_url: cl.logo_url,
        last_moved_at: c.registered_at,
        registered_at: c.registered_at,
        notes: c.notes,
        carried_over: c.carried_over,
        title: c.title ?? '',
        cambios_count: c.cambios_count ?? 0,
        review_started_at: c.review_started_at ?? null,
        priority: (c.priority ?? 'media') as import('@/types/db').Priority,
        estimated_time_minutes: c.estimated_time_minutes ?? null,
        assigned_to: (c.assigned_to as string[] | null) ?? null,
        assignees: ((c.assigned_to as string[] | null) ?? []).map(uid => ({
          id: uid,
          name: usersMap[uid]?.name ?? uid,
          avatar_url: usersMap[uid]?.avatar_url ?? null,
        })),
        includes_story: c.includes_story ?? false,
        deadline: c.deadline ?? null,
      })
    }

    if (items.length > 0) {
      const { data: logsRaw } = await supabase
        .from('requirement_phase_logs')
        .select('*')
        .in('requirement_id', items.map(i => i.id))
        .order('created_at', { ascending: true })

      for (const log of logsRaw ?? []) {
        if (!logsMap[log.requirement_id]) logsMap[log.requirement_id] = []
        logsMap[log.requirement_id].push(log as RequirementPhaseLog)
      }

      for (const item of items) {
        const itemLogs = logsMap[item.id] ?? []
        if (itemLogs.length > 0) {
          item.last_moved_at = itemLogs[itemLogs.length - 1].created_at
        }
      }
    }
  }

  // Clients present in current cycles (for filter dropdown)
  const cycleClientIds = [...new Set((currentCycles ?? []).map(c => c.client_id))]
  const { data: pipelineClients } = cycleClientIds.length > 0
    ? await supabase.from('clients').select('id, name').in('id', cycleClientIds).order('name')
    : { data: [] }

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Pipeline" />
      <div className="flex-1 p-6 flex flex-col overflow-hidden">
        <PipelineContainer
          items={items}
          logsMap={logsMap}
          currentUserId={authUser.id}
          canAssign={canAssign}
          isAdmin={isAdmin}
          clients={pipelineClients ?? []}
        />
      </div>
    </div>
  )
}
