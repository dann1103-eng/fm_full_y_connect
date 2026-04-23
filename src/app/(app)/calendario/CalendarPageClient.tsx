'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import { Calendar, dateFnsLocalizer } from 'react-big-calendar'
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop'
import {
  format, parse, startOfWeek, getDay,
  startOfMonth, endOfMonth, startOfDay, endOfDay, addDays,
} from 'date-fns'
import { es } from 'date-fns/locale'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'
import type { AppUser, ContentType, Phase, Priority, RequirementPhaseLog } from '@/types/db'
import { createClient } from '@/lib/supabase/client'
import { useCalendarEvents } from '@/hooks/useCalendarEvents'
import { NewInternalEventModal } from './NewInternalEventModal'
import { PhaseSheet } from '@/components/pipeline/PhaseSheet'
import { rescheduleEvent } from '@/app/actions/calendar'
import type { CalendarEvent, CalendarEventKind } from '@/lib/domain/calendar'
import { KIND_COLORS, KIND_COLORS_DARK, KIND_LABELS, isScheduledKind } from '@/lib/domain/calendar'
import { Loader2 } from 'lucide-react'

interface CalendarReqDetail {
  requirementId: string
  contentType: ContentType
  currentPhase: Phase
  clientName: string
  clientId: string
  title: string
  notes: string | null
  cambiosCount: number
  reviewStartedAt: string | null
  priority: Priority
  estimatedTimeMinutes: number | null
  assignedTo: string[] | null
  assignees: { id: string; name: string; avatar_url: string | null }[]
  deadline: string | null
  includesStory: boolean
}

type UserLite = { id: string; full_name: string; avatar_url: string | null }

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

function makeCalendarEventCard(allUsers: UserLite[], isDark: boolean, view: ViewType) {
  function CalendarEventCard({ event }: { event: CalendarEvent }) {
    const color = isDark ? KIND_COLORS_DARK[event.kind] : KIND_COLORS[event.kind]
    const lightColor = KIND_COLORS[event.kind]
    const scheduled = isScheduledKind(event.kind)

    // ── Month view: compact single-line chip for ALL events ──
    if (view === 'month') {
      const chipTextColor = scheduled ? '#fff' : color
      const dotColor = scheduled ? lightColor : color
      return (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 3,
          padding: '0 5px', height: '100%', overflow: 'hidden',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: dotColor,
          }} />
          {event.clientLogoUrl && (
            <img src={event.clientLogoUrl} alt=""
              style={{ width: 11, height: 11, borderRadius: 2, objectFit: 'cover', flexShrink: 0 }} />
          )}
          <span style={{
            fontSize: 10, fontWeight: 600,
            color: chipTextColor,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {event.title}
          </span>
        </div>
      )
    }

    // ── All-day deadline chip (arte / legacy scheduled in week/day view) ──
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
      .filter((u): u is UserLite => !!u)
    const visibleAttendees = attendeeUsers.slice(0, 3)
    const extraCount = event.attendees.length - 3

    // Avatar colors deterministic by initial
    const avatarColors = ['#7c5cbf', '#2196f3', '#e91e63', '#4caf50', '#ff9800', '#00bcd4']
    const avatarColor = (name: string) => avatarColors[name.charCodeAt(0) % avatarColors.length]

    // Both modes now use solid opaque card bg → white text works in both
    const textColor = '#fff'
    const pillBg = 'rgba(255,255,255,.18)'
    const pillBorder = 'none'
    const avatarBorder = '1.5px solid rgba(255,255,255,.6)'
    const avatarInitialBg = 'rgba(255,255,255,.25)'

    return (
      <div style={{ padding: '7px 8px', overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>

        {/* Type tag or Interno badge */}
        {event.kind === 'reunion_interna' ? (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            background: pillBg, borderRadius: 4, border: pillBorder,
            padding: '1px 5px', fontSize: 9, fontWeight: 700,
            letterSpacing: '.04em', marginBottom: 3, width: 'fit-content', color: textColor,
          }}>
            ● Interno FM
          </div>
        ) : (
          <div style={{
            display: 'inline-flex', alignItems: 'center',
            background: pillBg, borderRadius: 3, border: pillBorder,
            padding: '1px 5px', fontSize: 9, fontWeight: 700,
            letterSpacing: '.04em', marginBottom: 4, textTransform: 'uppercase',
            color: textColor, width: 'fit-content',
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
                background: avatarInitialBg, color: textColor,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, fontWeight: 800,
              }}>
                {event.clientName[0].toUpperCase()}
              </span>
            ) : null
          )}
          <span style={{
            fontSize: 11.5, fontWeight: 700, lineHeight: 1.2, color: textColor,
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', flex: 1,
          }}>
            {event.title}
          </span>
        </div>

        {/* Time */}
        <div style={{ fontSize: 9.5, fontWeight: 500, opacity: .82, marginBottom: 5, color: textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {timeStr}{event.clientName && event.kind !== 'reunion_interna' ? ` · ${event.clientName}` : ''}
        </div>

        {/* Attendee avatars */}
        {visibleAttendees.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 'auto' }}>
            {visibleAttendees.map((u, i) => (
              u.avatar_url ? (
                <img
                  key={u.id}
                  src={u.avatar_url}
                  alt={u.full_name}
                  title={u.full_name}
                  style={{
                    width: 17, height: 17, borderRadius: '50%',
                    border: avatarBorder,
                    objectFit: 'cover',
                    marginLeft: i === 0 ? 0 : -5,
                    flexShrink: 0,
                  }}
                />
              ) : (
                <span key={u.id} title={u.full_name} style={{
                  width: 17, height: 17, borderRadius: '50%',
                  border: avatarBorder,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 7, fontWeight: 800,
                  marginLeft: i === 0 ? 0 : -5,
                  background: avatarColor(u.full_name),
                  color: '#fff', flexShrink: 0,
                }}>
                  {u.full_name[0].toUpperCase()}
                </span>
              )
            ))}
            {extraCount > 0 && (
              <span style={{
                width: 17, height: 17, borderRadius: '50%',
                border: avatarBorder,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 7, fontWeight: 800, marginLeft: -5,
                background: 'rgba(255,255,255,.2)',
                color: 'rgba(255,255,255,.9)',
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
  allUsers: UserLite[]
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
  const [sheetLoading, setSheetLoading] = useState(false)
  const [detailReq, setDetailReq] = useState<CalendarReqDetail | null>(null)
  const [detailLogs, setDetailLogs] = useState<Array<RequirementPhaseLog & { moved_by_user?: { id: string; full_name: string | null; avatar_url: string | null } | null }>>([])

  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  )
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    obs.observe(document.documentElement, { attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

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
    const lightColor = KIND_COLORS[event.kind]
    const darkColor = KIND_COLORS_DARK[event.kind]
    const color = isDark ? darkColor : lightColor
    const scheduled = isScheduledKind(event.kind)

    if (view === 'month') {
      // Month view: compact pill — scheduled use solid color, arte use tinted bg + left border
      if (scheduled) {
        return {
          style: {
            background: lightColor,
            border: 'none',
            borderRadius: '4px',
            padding: 0,
            color: '#fff',
            boxShadow: 'none',
          },
        }
      }
      // Arte deadline chip in month view
      return {
        style: {
          background: isDark ? `${darkColor}20` : `${lightColor}18`,
          border: 'none',
          borderLeft: `3px solid ${color}`,
          borderRadius: '4px',
          padding: 0,
          color,
          boxShadow: 'none',
        },
      }
    }

    if (scheduled && !event.allDay) {
      // Week/day view: solid opaque card background
      const darkBg: Record<string, string> = {
        reunion:         '#363d8c',
        produccion:      '#7a1219',
        reunion_interna: '#383b3d',
      }
      const bg = isDark ? (darkBg[event.kind] ?? lightColor) : lightColor
      return {
        style: {
          background: bg,
          border: isDark ? `1px solid ${darkColor}99` : 'none',
          borderRadius: '8px',
          padding: 0,
          color: '#fff',
          boxShadow: isDark ? '0 1px 6px rgba(0,0,0,.4)' : '0 1px 4px rgba(0,0,0,.1)',
        },
      }
    }
    // All-day arte chip (week/day view)
    return {
      style: {
        background: isDark ? `${darkColor}20` : `${lightColor}18`,
        border: 'none',
        borderLeft: `3px solid ${color}`,
        borderRadius: '4px',
        padding: 0,
        color,
        boxShadow: 'none',
      },
    }
  }, [isDark, view])

  // Custom components — memoized to avoid re-mounting on every render
  const components = useMemo(() => ({
    event: makeCalendarEventCard(allUsers, isDark, view),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [allUsers, isDark, view])

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

  const handleSelectEvent = useCallback(async (event: CalendarEvent) => {
    if (!event.requirementId) return
    setSheetLoading(true)
    setDetailReq(null)
    setDetailLogs([])

    const supabase = createClient()
    const [{ data: req }, { data: logs }] = await Promise.all([
      supabase
        .from('requirements')
        .select(`
          id, content_type, phase, title, notes, cambios_count, deadline, includes_story,
          review_started_at, priority, estimated_time_minutes, assigned_to,
          billing_cycles ( clients ( id, name ) )
        `)
        .eq('id', event.requirementId)
        .single(),
      supabase
        .from('requirement_phase_logs')
        .select('*, moved_by_user:users!moved_by(id, full_name, avatar_url)')
        .eq('requirement_id', event.requirementId)
        .order('created_at'),
    ])

    setSheetLoading(false)
    if (!req) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cycle = (req as any).billing_cycles
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = (cycle as any)?.clients

    setDetailReq({
      requirementId: req.id,
      contentType: req.content_type as ContentType,
      currentPhase: req.phase as Phase,
      clientName: client?.name ?? '—',
      clientId: client?.id ?? '',
      title: req.title ?? '',
      notes: req.notes,
      cambiosCount: req.cambios_count,
      reviewStartedAt: req.review_started_at,
      priority: (req.priority as Priority) ?? 'media',
      estimatedTimeMinutes: req.estimated_time_minutes,
      assignedTo: req.assigned_to,
      assignees: allUsers
        .filter(u => (req.assigned_to ?? []).includes(u.id))
        .map(u => ({ id: u.id, name: u.full_name, avatar_url: u.avatar_url })),
      deadline: req.deadline ?? null,
      includesStory: req.includes_story ?? false,
    })
    setDetailLogs((logs ?? []) as unknown as typeof detailLogs)
  }, [allUsers])

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
          views={['month', 'week', 'day']}
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
          onSelectEvent={handleSelectEvent}
          draggableAccessor={(event) => isPrivileged && isScheduledKind((event as CalendarEvent).kind)}
          onEventDrop={handleEventDrop}
          onDragOver={(e) => e.preventDefault()}
          resizable={false}
          style={{ height: '100%' }}
          popup
          dayLayoutAlgorithm="no-overlap"
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

      {/* Loading indicator while fetching requirement */}
      {sheetLoading && (
        <div className="fixed inset-y-0 right-0 z-50 w-80 flex items-center justify-center bg-fm-surface-container-lowest/80 backdrop-blur-sm border-l border-fm-surface-container-high shadow-2xl">
          <div className="flex flex-col items-center gap-3 text-fm-on-surface-variant">
            <Loader2 className="w-6 h-6 animate-spin text-fm-primary" />
            <span className="text-sm">Cargando requerimiento…</span>
          </div>
        </div>
      )}

      {/* Requirement detail sheet — opens on card click */}
      {detailReq && (
        <PhaseSheet
          open={true}
          onClose={() => setDetailReq(null)}
          requirementId={detailReq.requirementId}
          contentType={detailReq.contentType}
          currentPhase={detailReq.currentPhase}
          clientName={detailReq.clientName}
          clientId={detailReq.clientId}
          logs={detailLogs}
          currentUserId={currentUser.id}
          title={detailReq.title}
          requirementNotes={detailReq.notes}
          cambiosCount={detailReq.cambiosCount}
          reviewStartedAt={detailReq.reviewStartedAt}
          priority={detailReq.priority}
          estimatedTimeMinutes={detailReq.estimatedTimeMinutes}
          assignedTo={detailReq.assignedTo}
          assignees={detailReq.assignees}
          canAssign={isPrivileged}
          includesStory={detailReq.includesStory}
          deadline={detailReq.deadline}
          isAdmin={isPrivileged}
          showMoveSection={isPrivileged}
        />
      )}
    </div>
  )
}
