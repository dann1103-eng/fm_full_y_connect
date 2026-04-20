import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { KanbanBoard } from '@/components/pipeline/KanbanBoard'
import { PIPELINE_CONTENT_TYPES, PHASES } from '@/lib/domain/pipeline'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase, RequirementPhaseLog, Client } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string }>
}) {
  const { clientId } = await searchParams
  const supabase = await createClient()

  // Usuario actual
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) return null

  const { data: appUser } = await supabase.from('users').select('role').eq('id', authUser.id).single()
  const canAssign = appUser?.role === 'admin' || appUser?.role === 'supervisor'

  // 1. Ciclos activos (current), opcionalmente filtrados por cliente
  let cyclesQuery = supabase
    .from('billing_cycles')
    .select('id, client_id')
    .eq('status', 'current')

  if (clientId) cyclesQuery = cyclesQuery.eq('client_id', clientId)

  const { data: currentCycles } = await cyclesQuery
  const currentCycleIds = (currentCycles ?? []).map((c) => c.id)

  // 2. Requerimientos de esos ciclos (no voided, no produccion)
  const items: PipelineItem[] = []
  const logsMap: Record<string, RequirementPhaseLog[]> = {}

  if (currentCycleIds.length > 0) {
    const { data: requirementsRaw } = await supabase
      .from('requirements')
      .select('id, content_type, phase, carried_over, billing_cycle_id, registered_at, notes, title, cambios_count, review_started_at, priority, estimated_time_minutes, assigned_to')
      .eq('voided', false)
      .in('content_type', PIPELINE_CONTENT_TYPES)
      .in('billing_cycle_id', currentCycleIds)
      .order('registered_at', { ascending: false })
      .limit(200)

    // 3. Info de clientes (mapa cycle_id → client_id, luego clientes)
    const cycleClientMap: Record<string, string> = {}
    for (const c of currentCycles ?? []) cycleClientMap[c.id] = c.client_id

    const uniqueClientIds = [...new Set(Object.values(cycleClientMap))]
    const { data: clientsRaw } = await supabase
      .from('clients')
      .select('id, name, logo_url')
      .in('id', uniqueClientIds)

    const clientMap: Record<string, Pick<Client, 'id' | 'name' | 'logo_url'>> = {}
    for (const cl of clientsRaw ?? []) clientMap[cl.id] = cl

    const { data: usersRaw } = await supabase.from('users').select('id, full_name')
    const usersMap: Record<string, string> = {}
    for (const u of usersRaw ?? []) usersMap[u.id] = u.full_name

    // Armar PipelineItem
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
        assigned_to: c.assigned_to ?? null,
        assignee_name: c.assigned_to ? (usersMap[c.assigned_to] ?? null) : null,
      })
    }

    // Logs de todas las piezas
    if (items.length > 0) {
      const { data: logsRaw } = await supabase
        .from('requirement_phase_logs')
        .select('*')
        .in('requirement_id', items.map((i) => i.id))
        .order('created_at', { ascending: true })

      for (const log of logsRaw ?? []) {
        if (!logsMap[log.requirement_id]) logsMap[log.requirement_id] = []
        logsMap[log.requirement_id].push(log as RequirementPhaseLog)
      }

      // Actualizar last_moved_at con el máximo del log
      for (const item of items) {
        const itemLogs = logsMap[item.id] ?? []
        if (itemLogs.length > 0) {
          item.last_moved_at = itemLogs[itemLogs.length - 1].created_at
        }
      }
    }
  }

  // Agrupar por fase
  const byPhase = Object.fromEntries(PHASES.map(p => [p, [] as PipelineItem[]])) as Record<Phase, PipelineItem[]>
  for (const item of items) {
    byPhase[item.phase as Phase]?.push(item)
  }

  // Lista de clientes para el filtro (todos los activos)
  const { data: allClients } = await supabase
    .from('clients')
    .select('id, name')
    .eq('status', 'active')
    .order('name')

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Pipeline" />

      <div className="flex-1 p-6 flex flex-col gap-4 overflow-hidden">
        {/* Filtro por cliente */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-[#595c5e]">Cliente:</span>
          <form method="GET">
            <select
              name="clientId"
              defaultValue={clientId ?? ''}
              className="text-sm border border-[#dfe3e6] rounded-xl px-3 py-1.5 bg-white text-[#2c2f31]"
            >
              <option value="">Todos los clientes</option>
              {(allClients ?? []).map((cl) => (
                <option key={cl.id} value={cl.id}>
                  {cl.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="ml-2 text-sm px-3 py-1.5 rounded-xl bg-[#00675c] text-white"
            >
              Filtrar
            </button>
          </form>
        </div>

        {/* Kanban */}
        <div className="flex-1 overflow-x-auto">
          <KanbanBoard
            byPhase={byPhase}
            logsMap={logsMap}
            currentUserId={authUser.id}
            canAssign={canAssign}
          />
        </div>
      </div>
    </div>
  )
}
