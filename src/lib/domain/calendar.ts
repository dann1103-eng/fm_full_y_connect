import type { ContentType } from '@/types/db'

export type CalendarEventKind = 'arte' | 'reunion' | 'produccion' | 'reunion_interna'

export interface CalendarEvent {
  id: string
  source: 'requirement' | 'time_entry'
  kind: CalendarEventKind
  title: string
  start: Date
  end: Date
  allDay: boolean
  clientId: string | null
  clientName: string | null
  clientLogoUrl: string | null
  requirementId: string | null
  attendees: string[]
}

const SCHEDULED_TYPES: ContentType[] = ['reunion', 'produccion']
const ART_TYPES: ContentType[] = ['historia', 'estatico', 'video_corto', 'reel', 'short', 'matriz_contenido']

export function requirementToCalendarEvent(
  req: {
    id: string
    content_type: ContentType
    title: string
    starts_at: string | null
    deadline: string | null
    estimated_time_minutes: number | null
    assigned_to: string[] | null
    billing_cycle_id: string
  },
  clientName: string | null,
  clientId: string | null,
  clientLogoUrl: string | null = null
): CalendarEvent | null {
  if (SCHEDULED_TYPES.includes(req.content_type)) {
    if (req.starts_at) {
      const start = new Date(req.starts_at)
      const end = new Date(start.getTime() + (req.estimated_time_minutes ?? 60) * 60 * 1000)
      return {
        id: `req-${req.id}`,
        source: 'requirement',
        kind: req.content_type as 'reunion' | 'produccion',
        title: req.title || req.content_type,
        start,
        end,
        allDay: false,
        clientId,
        clientName,
        clientLogoUrl,
        requirementId: req.id,
        attendees: req.assigned_to ?? [],
      }
    }
    // Legacy: sin starts_at → all-day en deadline
    if (req.deadline) {
      const start = new Date(req.deadline + 'T00:00:00')
      const end = new Date(req.deadline + 'T23:59:59')
      return {
        id: `req-${req.id}`,
        source: 'requirement',
        kind: req.content_type as 'reunion' | 'produccion',
        title: req.title || req.content_type,
        start,
        end,
        allDay: true,
        clientId,
        clientName,
        clientLogoUrl,
        requirementId: req.id,
        attendees: req.assigned_to ?? [],
      }
    }
    return null
  }

  if (ART_TYPES.includes(req.content_type) && req.deadline) {
    const start = new Date(req.deadline + 'T00:00:00')
    const end = new Date(req.deadline + 'T23:59:59')
    return {
      id: `req-${req.id}`,
      source: 'requirement',
      kind: 'arte',
      title: req.title || req.content_type,
      start,
      end,
      allDay: true,
      clientId,
      clientName,
      clientLogoUrl,
      requirementId: req.id,
      attendees: req.assigned_to ?? [],
    }
  }

  return null
}

export function timeEntryToCalendarEvent(entry: {
  id: string
  title: string
  scheduled_at: string | null
  scheduled_duration_minutes: number | null
  scheduled_attendees: string[]
}): CalendarEvent | null {
  if (!entry.scheduled_at) return null
  const start = new Date(entry.scheduled_at)
  const end = new Date(start.getTime() + (entry.scheduled_duration_minutes ?? 60) * 60 * 1000)
  return {
    id: `te-${entry.id}`,
    source: 'time_entry',
    kind: 'reunion_interna',
    title: entry.title || 'Reunión interna',
    start,
    end,
    allDay: false,
    clientId: null,
    clientName: null,
    clientLogoUrl: null,
    requirementId: null,
    attendees: entry.scheduled_attendees ?? [],
  }
}

export const KIND_COLORS: Record<CalendarEventKind, string> = {
  arte:            '#00675c',
  reunion:         '#5b6af4',
  produccion:      '#b31b25',
  reunion_interna: '#595c5e',
}

/** Colors adjusted for dark-mode (lighter so they pop on dark surfaces). */
export const KIND_COLORS_DARK: Record<CalendarEventKind, string> = {
  arte:            '#48e5d0',
  reunion:         '#818cf8',
  produccion:      '#f87171',
  reunion_interna: '#9ca3af',
}

export const KIND_LABELS: Record<CalendarEventKind, string> = {
  arte:            'Requerimiento',
  reunion:         'Reunión',
  produccion:      'Producción',
  reunion_interna: 'Reunión interna',
}

export function isScheduledKind(kind: CalendarEventKind): boolean {
  return kind === 'reunion' || kind === 'produccion' || kind === 'reunion_interna'
}
