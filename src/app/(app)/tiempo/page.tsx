import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TopNav } from '@/components/layout/TopNav'
import { ClockInPanel } from '@/components/tiempo/ClockInPanel'
import { MyTimeHistory } from '@/components/tiempo/MyTimeHistory'
import { AdminTimePanel } from '@/components/tiempo/AdminTimePanel'
import type { TimeEntry, AppUser } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function TiempoPage() {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) redirect('/login')

  const { data: appUser } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .single()
  if (!appUser) redirect('/login')

  const canViewTeam = appUser.role === 'admin' || appUser.role === 'supervisor'

  // Active entry for this user
  const { data: activeEntryRaw } = await supabase
    .from('time_entries')
    .select('*')
    .eq('user_id', authUser.id)
    .is('ended_at', null)
    .maybeSingle()
  const activeEntry = activeEntryRaw as TimeEntry | null

  // This month's entries
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()

  const { data: entriesRaw } = await supabase
    .from('time_entries')
    .select('*')
    .eq('user_id', authUser.id)
    .not('ended_at', 'is', null)
    .gte('started_at', monthStart)
    .lt('started_at', monthEnd)
    .order('started_at', { ascending: false })
  const entries = (entriesRaw ?? []) as TimeEntry[]

  // All users (admin + supervisor)
  let allUsers: AppUser[] = []
  if (canViewTeam) {
    const { data: usersRaw } = await supabase
      .from('users')
      .select('*')
      .order('full_name')
    allUsers = (usersRaw ?? []) as AppUser[]
  }

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Tiempo" />

      <div className="flex-1 p-6 max-w-4xl mx-auto w-full space-y-6">

        {canViewTeam ? (
          <TiempoTabs
            userId={authUser.id}
            activeEntry={activeEntry}
            entries={entries}
            year={now.getFullYear()}
            month={now.getMonth()}
            allUsers={allUsers}
          />
        ) : (
          <PersonalView
            userId={authUser.id}
            activeEntry={activeEntry}
            entries={entries}
            year={now.getFullYear()}
            month={now.getMonth()}
          />
        )}
      </div>
    </div>
  )
}

// ── Personal view (non-admin) ──────────────────────────────────────────────

function PersonalView({ userId, activeEntry, entries, year, month }: {
  userId: string
  activeEntry: TimeEntry | null
  entries: TimeEntry[]
  year: number
  month: number
}) {
  return (
    <div className="space-y-5">
      <ClockInPanel initialActive={activeEntry} />
      <MyTimeHistory userId={userId} initialEntries={entries} initialYear={year} initialMonth={month} />
    </div>
  )
}

// ── Tabbed view (admin) ────────────────────────────────────────────────────

import { TiempoTabs } from '@/components/tiempo/TiempoTabs'
