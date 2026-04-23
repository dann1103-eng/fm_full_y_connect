import { createClient } from '@/lib/supabase/server'
import { getActiveClientId } from '@/lib/supabase/active-client'
import { redirect } from 'next/navigation'
import { PortalCalendarioClient } from '@/components/portal/PortalCalendarioClient'
import { requirementToCalendarEvent } from '@/lib/domain/calendar'
import type { ContentType } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function PortalCalendarioPage() {
  const clientId = await getActiveClientId()
  if (!clientId) redirect('/portal/seleccionar-marca')

  const supabase = await createClient()

  // Get current billing cycle
  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, start_date, end_date')
    .eq('client_id', clientId)
    .eq('status', 'current')
    .maybeSingle()

  if (!cycle) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold text-fm-on-surface mb-2">Calendario</h1>
        <p className="text-sm text-fm-on-surface-variant">No tienes un ciclo de facturación activo actualmente.</p>
      </div>
    )
  }

  // Query requirements with a deadline or starts_at
  const { data: reqs } = await supabase
    .from('requirements')
    .select('id, content_type, title, starts_at, deadline, estimated_time_minutes, assigned_to, billing_cycle_id')
    .eq('billing_cycle_id', cycle.id)
    .eq('voided', false)
    .or('deadline.not.is.null,starts_at.not.is.null')

  // Convert to serializable event shape (ISO strings, not Date objects — server component)
  type SerialEvent = {
    id: string
    kind: string
    title: string
    start: string
    end: string
    allDay: boolean
  }

  const events: SerialEvent[] = []
  for (const req of reqs ?? []) {
    const ev = requirementToCalendarEvent(
      {
        id: req.id,
        content_type: req.content_type as ContentType,
        title: req.title,
        starts_at: req.starts_at,
        deadline: req.deadline,
        estimated_time_minutes: req.estimated_time_minutes,
        assigned_to: req.assigned_to as string[] | null,
        billing_cycle_id: req.billing_cycle_id,
      },
      null, null, null
    )
    if (ev) {
      events.push({
        id: ev.id,
        kind: ev.kind,
        title: ev.title,
        start: ev.start.toISOString(),
        end: ev.end.toISOString(),
        allDay: ev.allDay,
      })
    }
  }

  // Default calendar date: start of current cycle or today
  const defaultDate = cycle.start_date ?? new Date().toISOString().split('T')[0]

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <div className="p-6 pb-0">
        <h1 className="text-xl font-semibold text-fm-on-surface mb-4">Calendario</h1>
      </div>
      <div className="flex-1 px-6 pb-6 overflow-hidden">
        <PortalCalendarioClient events={events} defaultDate={defaultDate} />
      </div>
    </div>
  )
}
