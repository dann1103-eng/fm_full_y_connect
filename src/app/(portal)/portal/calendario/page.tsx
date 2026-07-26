import { createClient } from '@/lib/supabase/server'
import { getActiveClientId } from '@/lib/supabase/active-client'
import { requirePortalCapability } from '@/lib/auth/portal-permissions'
import { redirect } from 'next/navigation'
import { PortalCalendarioClient } from '@/components/portal/PortalCalendarioClient'
import { requirementToCalendarEvent } from '@/lib/domain/calendar'
import { clientPhaseOf, CLIENT_PHASE_LABELS } from '@/lib/domain/pipeline'
import type { CalendarEventKind } from '@/lib/domain/calendar'
import type { ContentType, Phase } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function PortalCalendarioPage() {
  await requirePortalCapability('work')
  const clientId = await getActiveClientId()
  if (!clientId) redirect('/login')

  const supabase = await createClient()

  // Get current billing cycle
  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, period_start, period_end')
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

  // Query requirements with a deadline or starts_at — include phase and notes for popup
  const { data: reqs } = await supabase
    .from('requirements')
    .select('id, content_type, title, starts_at, deadline, estimated_time_minutes, assigned_to, billing_cycle_id, phase, notes, review_started_at')
    .eq('billing_cycle_id', cycle.id)
    .eq('voided', false)
    .eq('approval_status', 'approved')
    .or('deadline.not.is.null,starts_at.not.is.null')

  // Serializable event shape (ISO strings, not Date objects — server component)
  type SerialEvent = {
    id: string
    kind: CalendarEventKind
    title: string
    start: string
    end: string
    allDay: boolean
    phaseLabel: string | null
    /** Fase real de pipeline — necesario para gatear el sheet de revisión cliente. */
    phase: Phase | null
    /** UUID del requirement para abrir el sheet. Null para eventos no-requirement. */
    requirementId: string | null
    /** Marca cuándo entró a revisión cliente; usado por el sheet de revisión. */
    reviewStartedAt: string | null
    notes: string | null
    deadline: string | null
  }

  const events: SerialEvent[] = []

  for (const req of reqs ?? []) {
    const clientPhase = req.phase ? clientPhaseOf(req.phase as Phase) : null
    const phaseLabel = clientPhase ? CLIENT_PHASE_LABELS[clientPhase] : null

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
        // All-day (deadline-based) events: serializar SIN sufijo 'Z' para que el
        // browser los interprete en hora local y no haya desfase de timezone
        // (el servidor corre en UTC; .toISOString() añadiría 'Z' y el browser
        // mostraría el evento un día antes en zonas UTC-N).
        start: ev.allDay && req.deadline
          ? req.deadline + 'T00:00:00'
          : ev.start.toISOString(),
        end: ev.allDay && req.deadline
          ? req.deadline + 'T23:59:59'
          : ev.end.toISOString(),
        allDay: ev.allDay,
        phaseLabel,
        phase: (req.phase as Phase | null) ?? null,
        requirementId: req.id,
        reviewStartedAt: (req.review_started_at as string | null) ?? null,
        notes: req.notes ?? null,
        deadline: req.deadline ?? null,
      })
    } else if (req.deadline) {
      // Fallback: any content_type with a deadline that the domain function doesn't map
      // (e.g. campaña, copy, etc.) still appears on the deadline date.
      // Sin 'Z' → hora local en el browser.
      events.push({
        id: `req-${req.id}`,
        kind: 'arte' as CalendarEventKind,
        title: req.title || req.content_type,
        start: req.deadline + 'T00:00:00',
        end: req.deadline + 'T23:59:59',
        allDay: true,
        phaseLabel,
        phase: (req.phase as Phase | null) ?? null,
        requirementId: req.id,
        reviewStartedAt: (req.review_started_at as string | null) ?? null,
        notes: req.notes ?? null,
        deadline: req.deadline,
      })
    }
  }

  // Default calendar date: start of current cycle or today
  const defaultDate = cycle.period_start ?? new Date().toISOString().split('T')[0]

  const { data: { user } } = await supabase.auth.getUser()
  const currentUserId = user?.id ?? ''

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <div className="p-6 pb-0">
        <h1 className="text-xl font-semibold text-fm-on-surface mb-4">Calendario</h1>
      </div>
      <div className="flex-1 px-6 pb-6 overflow-hidden">
        <PortalCalendarioClient
          events={events}
          defaultDate={defaultDate}
          clientId={clientId}
          currentUserId={currentUserId}
        />
      </div>
    </div>
  )
}
