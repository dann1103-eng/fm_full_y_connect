'use client'

import { useState, useCallback, useMemo } from 'react'
import { Calendar, dateFnsLocalizer } from 'react-big-calendar'
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop'
import {
  format, parse, startOfWeek, getDay,
  startOfMonth, endOfMonth, startOfDay, endOfDay, addDays,
} from 'date-fns'
import { es } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'
import type { AppUser } from '@/types/db'
import { useCalendarEvents } from '@/hooks/useCalendarEvents'
import { NewInternalEventModal } from './NewInternalEventModal'
import { rescheduleEvent } from '@/app/actions/calendar'
import type { CalendarEvent, CalendarEventKind } from '@/lib/domain/calendar'
import { KIND_COLORS, KIND_LABELS, isScheduledKind } from '@/lib/domain/calendar'

const locales = { es }
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d: Date) => startOfWeek(d, { weekStartsOn: 1 }),
  getDay,
  locales,
})
const DnDCalendar = withDragAndDrop<CalendarEvent>(Calendar)

type ViewType = 'month' | 'week' | 'day'
type FilterKind = 'todos' | 'produccion_reunion' | 'requerimientos'

// ── Event card ──────────────────────────────────────────────────────────────

function makeCalendarEventCard(allUsers: { id: string; full_name: string }[]) {
  function CalendarEventCard({ event }: { event: CalendarEvent }) {
    const color = KIND_COLORS[event.kind]
    const scheduled = isScheduledKind(event.kind)

    // ── All-day deadline chip (arte / legacy scheduled) ──
    if (event.allDay || !scheduled) {
      return (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '2px 6px', height: '100%', overflow: 'hidden',
        }}>
          {event.clientLogoUrl ? (
            <img src={event.clientLogoUrl} alt={event.clientName ?? ''}
              style={{ width: 13, height: 13, borderRadius: 3, objectFit: 'cover', flexShrink: 0 }} />
          ) : event.clientName ? (
            <span style={{
              width: 13, height: 13, borderRadius: 3, flexShrink: 0,
              background: color, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 7, fontWeight: 800,
            }}>
              {event.clientName[0].toUpperCase()}
            </span>
          ) : null}
          <span style={{
            fontSize: 10.5, fontWeight: 600, color,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {event.title}
          </span>
        </div>
      )
    }

    // ── Timed scheduled event — rich card (matches mockup exactly) ──
    const timeStr = `${format(event.start, 'HH:mm')} – ${format(event.end, 'HH:mm')}`

    const attendeeUsers = event.attendees
      .map(id => allUsers.find(u => u.id === id))
      .filter((u): u is { id: string; full_name: string } => !!u)
    const visibleAttendees = attendeeUsers.slice(0, 3)
    const extraCount = event.attendees.length - 3

    // Avatar colors deterministic by initial
    const avatarColors = ['#7c5cbf', '#2196f3', '#e91e63', '#4caf50', '#ff9800', '#00bcd4']
    const avatarColor = (name: string) => avatarColors[name.charCodeAt(0) % avatarColors.length]

    return (
      <div style={{ padding: '7px 8px', overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>

        {/* Type tag or Interno badge */}
        {event.kind === 'reunion_interna' ? (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            background: 'rgba(255,255,255,.18)', borderRadius: 4,
            padding: '1px 5px', fontSize: 9, fontWeight: 700,
            letterSpacing: '.04em', marginBottom: 3, width: 'fit-content', color: '#fff',
          }}>
            ● Interno FM
          </div>
        ) : (
          <div style={{
            display: 'inline-flex', alignItems: 'center',
            background: 'rgba(255,255,255,.15)', borderRadius: 3,
            padding: '1px 5px', fontSize: 9, fontWeight: 700,
            letterSpacing: '.04em', marginBottom: 4, textTransform: 'uppercase',
            color: '#fff', width: 'fit-content',
          }}>
            {event.kind === 'reunion' ? 'Reunión' : 'Producción'}
          </div>
        )}

        {/* Card top: logo + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3, minWidth: 0 }}>
          {event.kind !== 'reunion_interna' && (
            event.clientLogoUrl ? (
              <img src={event.clientLogoUrl} alt={event.clientName ?? ''}
                style={{ width: 18, height: 18, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
            ) : event.clientName ? (
              <span style={{
                width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                background: 'rgba(255,255,255,.25)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, fontWeight: 800,
              }}>
                {event.clientName[0].toUpperCase()}
              </span>
            ) : null
          )}
          <span style={{
            fontSize: 11.5, fontWeight: 700, lineHeight: 1.2, color: '#fff',
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', flex: 1,
          }}>
            {event.title}
          </span>
        </div>

        {/* Time */}
        <div style={{ fontSize: 9.5, fontWeight: 500, opacity: .82, marginBottom: 5, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {timeStr}{event.clientName && event.kind !== 'reunion_interna' ? ` · ${event.clientName}` : ''}
        </div>

        {/* Attendee avatars */}
        {visibleAttendees.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 'auto' }}>
            {visibleAttendees.map((u, i) => (
              <span key={u.id} title={u.full_name} style={{
                width: 17, height: 17, borderRadius: '50%',
                border: '1.5px solid rgba(255,255,255,.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 7, fontWeight: 800,
                marginLeft: i === 0 ? 0 : -5,
                background: avatarColor(u.full_name),
                color: '#fff', flexShrink: 0,
              }}>
                {u.full_name[0].toUpperCase()}
              </span>
            ))}
            {extraCount > 0 && (
              <span style={{
                width: 17, height: 17, borderRadius: '50%',
                border: '1.5px solid rgba(255,255,255,.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 7, fontWeight: 800, marginLeft: -5,
                background: 'rgba(255,255,255,.2)', color: 'rgba(255,255,255,.9)',
              }}>
                +{extraCount}
              </span>
            )}
          </div>
        )}
      </div>
    )
  }
  CalendarEventCard.displayName = 'CalendarEventCard'
  return CalendarEventCard
}

// ── Main component ──────────────────────────────────────────────────────────

interface Props {
  currentUser: AppUser
  isPrivileged: boolean
  allUsers: { id: string; full_name: string }[]
  clients: { id: string; name: string }[]
}

export function CalendarPageClient({ currentUser, isPrivileged, allUsers, clients }: Props) {
  const [view, setView] = useState<ViewType>('month')
  const [date, setDate] = useState(new Date())
  const [calendarMode, setCalendarMode] = useState<'personal' | 'general'>('personal')
  const [filterKind, setFilterKind] = useState<FilterKind>('todos')
  const [filterClientId, setFilterClientId] = useState<string>('')
  const [newEventSlot, setNewEventSlot] = useState<string | null>(null)
  const [dragError, setDragError] = useState<string | null>(null)

  const rangeStart = useMemo(() => {
    if (view === 'month') return startOfMonth(addDays(date, -7))
    if (view === 'week') return startOfWeek(date, { weekStartsOn: 1 })
    return startOfDay(date)
  }, [view, date])

  const rangeEnd = useMemo(() => {
    if (view === 'month') return endOfMonth(addDays(date, 7))
    if (view === 'week') return addDays(startOfWeek(date, { weekStartsOn: 1 }), 7)
    return endOfDay(date)
  }, [view, date])

  const { events, loading } = useCalendarEvents({
    userId: currentUser.id,
    isGeneral: calendarMode === 'general' && isPrivileged,
    rangeStart,
    rangeEnd,
    allUsers,
  })

  // Scheduled kinds appear first within each day (sort by priority then start time)
  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      const aScheduled = isScheduledKind(a.kind) ? 0 : 1
      const bScheduled = isScheduledKind(b.kind) ? 0 : 1
      if (aScheduled !== bScheduled) return aScheduled - bScheduled
      return a.start.getTime() - b.start.getTime()
    })
  }, [events])

  const filteredEvents = useMemo(() => {
    let result = sortedEvents
    if (filterKind === 'produccion_reunion') {
      result = result.filter(e => isScheduledKind(e.kind))
    } else if (filterKind === 'requerimientos') {
      result = result.filter(e => e.kind === 'arte')
    }
    if (filterClientId) {
      result = result.filter(e => e.clientId === filterClientId)
    }
    return result
  }, [sortedEvents, filterKind, filterClientId])

  const eventPropGetter = useCallback((event: CalendarEvent) => {
    const color = KIND_COLORS[event.kind]
    const scheduled = isScheduledKind(event.kind)
    if (scheduled && !event.allDay) {
      return {
        style: {
          background: color,
          border: 'none',
          borderRadius: '8px',
          padding: 0,
          color: '#fff',
          boxShadow: '0 1px 4px rgba(0,0,0,.1)',
        },
      }
    }
    // All-day arte chip
    return {
      style: {
        background: color + '18',
        border: 'none',
        borderLeft: `3px solid ${color}`,
        borderRadius: '4px',
        padding: 0,
        color,
        boxShadow: 'none',
      },
    }
  }, [])

  // Custom components — memoized to avoid re-mounting on every render
  const components = useMemo(() => ({
    event: makeCalendarEventCard(allUsers),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [allUsers])

  const handleSelectSlot = useCallback(({ start }: { start: Date }) => {
    if (!isPrivileged) return
    const localStr = format(start, "yyyy-MM-dd'T'HH:mm")
    setNewEventSlot(localStr)
  }, [isPrivileged])

  const handleEventDrop = useCallback(async ({
    event,
    start,
  }: {
    event: CalendarEvent
    start: Date | string
  }) => {
    if (!isPrivileged) return
    setDragError(null)
    const newStart = typeof start === 'string' ? new Date(start) : start
    const rawId = event.requirementId ?? event.id.replace('te-', '')
    const res = await rescheduleEvent({ source: event.source, id: rawId, new_starts_at: newStart.toISOString() })
    if (res.error) setDragError(res.error)
  }, [isPrivileged])

  const messages = {
    today: 'Hoy', previous: '‹', next: '›',
    month: 'Mes', week: 'Semana', day: 'Día',
    date: 'Fecha', time: 'Hora', event: 'Evento',
    noEventsInRange: 'Sin eventos en este rango.',
    allDay: 'Todo el día',
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-b border-fm-surface-container-low bg-fm-surface-container-lowest flex-shrink-0">

        {/* Personal / General */}
        {isPrivileged && (
          <div className="flex rounded-lg overflow-hidden border border-fm-surface-container-high text-xs">
            {(['personal', 'general'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setCalendarMode(mode)}
                className={`px-3 py-1.5 font-semibold transition-colors ${
                  calendarMode === mode
                    ? 'bg-fm-primary text-white'
                    : 'text-fm-on-surface-variant hover:bg-fm-surface-container-high'
                }`}
              >
                {mode === 'personal' ? 'Personal' : 'General'}
              </button>
            ))}
          </div>
        )}

        {/* Vista */}
        <div className="flex rounded-lg overflow-hidden border border-fm-surface-container-high text-xs">
          {([
            { v: 'month' as ViewType, label: 'Mes' },
            { v: 'week' as ViewType, label: 'Semana' },
            { v: 'day' as ViewType, label: 'Día' },
          ]).map(({ v, label }) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 font-semibold transition-colors ${
                view === v
                  ? 'bg-fm-primary text-white'
                  : 'text-fm-on-surface-variant hover:bg-fm-surface-container-high'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Filtro tipo */}
        <select
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value as FilterKind)}
          className="px-2.5 py-1.5 text-xs bg-fm-background border border-fm-surface-container-high rounded-lg text-fm-on-surface focus:outline-none focus:border-fm-primary"
        >
          <option value="todos">Todos</option>
          <option value="produccion_reunion">Reuniones y Producciones</option>
          <option value="requerimientos">Solo Requerimientos</option>
        </select>

        {/* Filtro cliente */}
        {clients.length > 0 && (
          <select
            value={filterClientId}
            onChange={(e) => setFilterClientId(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-fm-background border border-fm-surface-container-high rounded-lg text-fm-on-surface focus:outline-none focus:border-fm-primary"
          >
            <option value="">Todos los clientes</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}

        {/* Leyenda */}
        <div className="ml-auto flex items-center gap-3">
          {(Object.entries(KIND_LABELS) as [CalendarEventKind, string][]).map(([kind, label]) => (
            <span key={kind} className="flex items-center gap-1.5 text-[11px] text-fm-on-surface-variant">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: KIND_COLORS[kind] }}
              />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Drag error */}
      {dragError && (
        <div className="mx-5 mt-2 px-4 py-2 bg-fm-error/10 border border-fm-error/30 rounded-xl text-sm text-fm-error flex items-center justify-between flex-shrink-0">
          <span>{dragError}</span>
          <button onClick={() => setDragError(null)} className="ml-4 text-fm-error/60 hover:text-fm-error text-lg leading-none">×</button>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-1.5 text-xs text-fm-on-surface-variant flex-shrink-0">
          Cargando eventos…
        </div>
      )}

      {/* Calendar */}
      <div className="flex-1 overflow-hidden px-4 pb-4 pt-3 calendar-wrapper">
        <DnDCalendar
          localizer={localizer}
          events={filteredEvents}
          view={view}
          date={date}
          onView={(v) => setView(v as ViewType)}
          onNavigate={setDate}
          messages={messages}
          culture="es"
          components={components}
          eventPropGetter={eventPropGetter}
          selectable={isPrivileged}
          onSelectSlot={handleSelectSlot}
          draggableAccessor={() => isPrivileged}
          onEventDrop={handleEventDrop}
          resizable={false}
          style={{ height: '100%' }}
          popup
          startAccessor="start"
          endAccessor="end"
          titleAccessor="title"
        />
      </div>

      {/* New internal event modal */}
      <NewInternalEventModal
        open={newEventSlot !== null}
        onClose={() => setNewEventSlot(null)}
        initialDatetime={newEventSlot ?? ''}
        allUsers={allUsers}
        currentUserId={currentUser.id}
      />
    </div>
  )
}
