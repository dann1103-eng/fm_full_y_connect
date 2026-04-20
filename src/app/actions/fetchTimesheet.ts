'use server'

import { createClient } from '@/lib/supabase/server'
import { canViewReports } from '@/lib/domain/permissions'
import type { TimesheetEntry, EntryTypeFilter } from '@/lib/domain/timesheet'
import type { AdminCategory, Phase } from '@/types/db'

interface Params {
  startIso: string
  endIso: string
  userIds?: string[]
  clientIds?: string[]
  entryType?: EntryTypeFilter
}

type RawTimeEntry = {
  id: string
  user_id: string
  requirement_id: string | null
  entry_type: 'requirement' | 'administrative'
  category: AdminCategory | null
  phase: string | null
  title: string
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  notes: string | null
  users: { id: string; full_name: string; avatar_url: string | null } | null
  requirements: {
    id: string
    title: string | null
    billing_cycles: {
      id: string
      client_id: string
      clients: { id: string; name: string; logo_url: string | null } | null
    } | null
  } | null
}

export async function fetchTimesheetEntries(
  params: Params,
): Promise<{ entries?: TimesheetEntry[]; error?: string }> {
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

    let query = supabase
      .from('time_entries')
      .select(
        `
        id, user_id, requirement_id, entry_type, category, phase, title,
        started_at, ended_at, duration_seconds, notes,
        users!time_entries_user_id_fkey ( id, full_name, avatar_url ),
        requirements (
          id, title,
          billing_cycles (
            id, client_id,
            clients ( id, name, logo_url )
          )
        )
      `,
      )
      .gte('started_at', params.startIso)
      .lt('started_at', params.endIso)
      .not('ended_at', 'is', null)
      .order('started_at', { ascending: false })

    if (params.userIds && params.userIds.length > 0) {
      query = query.in('user_id', params.userIds)
    }
    if (params.entryType && params.entryType !== 'all') {
      query = query.eq('entry_type', params.entryType)
    }

    const { data: rawData, error } = await query
    if (error) {
      console.error('fetchTimesheetEntries query error:', error)
      return { error: error.message }
    }

    const rows = (rawData ?? []) as unknown as RawTimeEntry[]

    let entries: TimesheetEntry[] = rows.map((r) => {
      const cycle = r.requirements?.billing_cycles ?? null
      const client = cycle?.clients ?? null
      const durationSeconds =
        r.duration_seconds ??
        (r.ended_at ? Math.max(0, Math.floor((new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 1000)) : 0)
      return {
        id: r.id,
        user_id: r.user_id,
        user_name: r.users?.full_name ?? '—',
        user_avatar_url: r.users?.avatar_url ?? null,
        client_id: client?.id ?? null,
        client_name: client?.name ?? null,
        client_logo_url: client?.logo_url ?? null,
        requirement_id: r.requirement_id,
        requirement_title: r.requirements?.title ?? null,
        entry_type: r.entry_type,
        category: r.category,
        phase: (r.phase as Phase | null) ?? null,
        title: r.title,
        started_at: r.started_at,
        ended_at: r.ended_at,
        duration_seconds: durationSeconds,
        notes: r.notes,
      }
    })

    if (params.clientIds && params.clientIds.length > 0) {
      const set = new Set(params.clientIds)
      entries = entries.filter((e) => e.client_id !== null && set.has(e.client_id))
    }

    return { entries }
  } catch (e) {
    console.error('fetchTimesheetEntries failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}
