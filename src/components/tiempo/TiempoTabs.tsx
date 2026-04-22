'use client'

import { useState } from 'react'
import { ClockInPanel } from '@/components/tiempo/ClockInPanel'
import { MyTimeHistory } from '@/components/tiempo/MyTimeHistory'
import { AdminTimePanel } from '@/components/tiempo/AdminTimePanel'
import type { TimeEntry, AppUser } from '@/types/db'

interface Props {
  userId: string
  activeEntry: TimeEntry | null
  entries: TimeEntry[]
  year: number
  month: number
  allUsers: AppUser[]
}

export function TiempoTabs({ userId, activeEntry, entries, year, month, allUsers }: Props) {
  const [tab, setTab] = useState<'personal' | 'equipo'>('personal')

  return (
    <div className="space-y-5">
      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-fm-surface-container-low rounded-2xl w-fit">
        {(['personal', 'equipo'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-xl text-sm font-bold transition-all ${
              tab === t ? 'bg-fm-surface-container-lowest text-fm-primary shadow-sm' : 'text-fm-on-surface-variant hover:text-fm-on-surface'
            }`}
          >
            {t === 'personal' ? 'Mi tiempo' : 'Equipo'}
          </button>
        ))}
      </div>

      {tab === 'personal' ? (
        <div className="space-y-5">
          <ClockInPanel initialActive={activeEntry} />
          <MyTimeHistory userId={userId} initialEntries={entries} initialYear={year} initialMonth={month} />
        </div>
      ) : (
        <AdminTimePanel users={allUsers} />
      )}
    </div>
  )
}
