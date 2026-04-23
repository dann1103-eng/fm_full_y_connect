'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { requirementToCalendarEvent, timeEntryToCalendarEvent } from '@/lib/domain/calendar'
import type { CalendarEvent } from '@/lib/domain/calendar'
import type { ContentType } from '@/types/db'

interface UseCalendarEventsOptions {
  userId: string
  isGeneral: boolean
  rangeStart: Date
  rangeEnd: Date
  allUsers: { id: string; full_name: string }[]
}

export function useCalendarEvents({ userId, isGeneral, rangeStart, rangeEnd, allUsers }: UseCalendarEventsOptions) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [refetchKey, setRefetchKey] = useState(0)
  const refetch = useCallback(() => setRefetchKey(k => k + 1), [])

  // Keep the latest range in refs so `refetch` can be called without
  // re-running the effect when only the range changed.
  const rangeStartRef = useRef(rangeStart)
  const rangeEndRef = useRef(rangeEnd)
  rangeStartRef.current = rangeStart
  rangeEndRef.current = rangeEnd

  useEffect(() => {
    let cancelled = false

    async function fetchEvents() {
      setLoading(true)
      const supabase = createClient()
      const startISO = rangeStart.toISOString()
      const endISO = rangeEnd.toISOString()

      // ── Requirements ────────────────────────────────────────────
      let reqQuery = supabase
        .from('requirements')
        .select(`
          id, content_type, title, starts_at, deadline,
          estimated_time_minutes, assigned_to, billing_cycle_id, voided,
          billing_cycles!inner(client_id, clients!inner(id, name, logo_url))
        `)
        .eq('voided', false)
        .or(
          `and(starts_at.gte.${startISO},starts_at.lte.${endISO}),` +
          `and(deadline.gte.${rangeStart.toISOString().split('T')[0]},deadline.lte.${rangeEnd.toISOString().split('T')[0]})`
        )

      if (!isGeneral) {
        reqQuery = reqQuery.contains('assigned_to', [userId])
      }

      const { data: reqRows } = await reqQuery

      // ── Time entries (internal meetings) ────────────────────────
      let teQuery = supabase
        .from('time_entries')
        .select('id, title, scheduled_at, scheduled_duration_minutes, scheduled_attendees')
        .eq('entry_type', 'administrative')
        .eq('category', 'reunion_interna')
        .not('scheduled_at', 'is', null)
        .gte('scheduled_at', startISO)
        .lte('scheduled_at', endISO)

      if (!isGeneral) {
        teQuery = teQuery.contains('scheduled_attendees', [userId])
      }

      const { data: teRows } = await teQuery

      if (cancelled) return

      const mapped: CalendarEvent[] = []

      for (const row of reqRows ?? []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cycleData = (row as any).billing_cycles
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const clientData = cycleData?.clients as any
        const clientId = clientData?.id ?? null
        const clientName = clientData?.name ?? null
        const clientLogoUrl = clientData?.logo_url ?? null
        const ev = requirementToCalendarEvent(
          {
            id: row.id,
            content_type: row.content_type as ContentType,
            title: row.title,
            starts_at: row.starts_at,
            deadline: row.deadline,
            estimated_time_minutes: row.estimated_time_minutes,
            assigned_to: row.assigned_to,
            billing_cycle_id: row.billing_cycle_id,
          },
          clientName,
          clientId,
          clientLogoUrl
        )
        if (ev) mapped.push(ev)
      }

      for (const row of teRows ?? []) {
        const ev = timeEntryToCalendarEvent(row)
        if (ev) mapped.push(ev)
      }

      setEvents(mapped)
      setLoading(false)
    }

    fetchEvents()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, isGeneral, rangeStart.getTime(), rangeEnd.getTime(), refetchKey])

  return { events, loading, refetch }
}
