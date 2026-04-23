'use client'

import { useMemo, useState } from 'react'
import { Calendar, dateFnsLocalizer } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay, parseISO, isValid } from 'date-fns'
import { es } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { KIND_COLORS } from '@/lib/domain/calendar'
import type { CalendarEventKind } from '@/lib/domain/calendar'

const locales = { es }
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d: Date) => startOfWeek(d, { weekStartsOn: 1 }),
  getDay,
  locales,
})

type SerialEvent = {
  id: string
  kind: CalendarEventKind
  title: string
  start: string
  end: string
  allDay: boolean
}

type CalEvent = {
  id: string
  kind: CalendarEventKind
  title: string
  start: Date
  end: Date
  allDay: boolean
}

interface Props {
  events: SerialEvent[]
  defaultDate: string
}

type ViewType = 'month' | 'week' | 'day'

export function PortalCalendarioClient({ events, defaultDate }: Props) {
  const [view, setView] = useState<ViewType>('month')
  const [date, setDate] = useState(() => {
    const parsed = parseISO(defaultDate)
    return isValid(parsed) ? parsed : new Date()
  })

  const calEvents = useMemo<CalEvent[]>(() => {
    const result: CalEvent[] = []
    for (const e of events) {
      const start = parseISO(e.start)
      const end = parseISO(e.end)
      if (!isValid(start) || !isValid(end)) continue
      result.push({
        id: e.id,
        kind: e.kind,
        title: e.title,
        start,
        end,
        allDay: e.allDay,
      })
    }
    return result
  }, [events])

  const eventStyleGetter = (event: CalEvent) => {
    const color = KIND_COLORS[event.kind] ?? '#595c5e'
    return {
      style: {
        backgroundColor: event.allDay ? 'transparent' : color,
        color: event.allDay ? color : '#fff',
        border: event.allDay ? `1.5px solid ${color}` : 'none',
        borderRadius: 4,
        fontSize: 12,
      },
    }
  }

  return (
    <div className="h-full [&_.rbc-calendar]:h-full [&_.rbc-toolbar-label]:font-semibold">
      <Calendar
        localizer={localizer}
        events={calEvents}
        startAccessor="start"
        endAccessor="end"
        allDayAccessor="allDay"
        titleAccessor="title"
        style={{ height: '100%' }}
        view={view}
        onView={(v) => setView(v as ViewType)}
        date={date}
        onNavigate={setDate}
        culture="es"
        selectable={false}
        eventPropGetter={eventStyleGetter}
        views={['month', 'week', 'day']}
        messages={{
          today: 'Hoy',
          previous: 'Anterior',
          next: 'Siguiente',
          month: 'Mes',
          week: 'Semana',
          day: 'Día',
          noEventsInRange: 'Sin eventos en este período.',
        }}
      />
    </div>
  )
}
