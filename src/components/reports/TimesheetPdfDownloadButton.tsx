'use client'

import { useState } from 'react'
import type { PrimaryGroup, SecondaryGroup, EntryTypeFilter } from '@/lib/domain/timesheet'

interface Props {
  params: {
    start: string
    end: string
    primary: PrimaryGroup
    secondary: SecondaryGroup
    entryType: EntryTypeFilter
    userIds: string[]
    clientIds: string[]
  }
}

export function TimesheetPdfDownloadButton({ params }: Props) {
  const [loading, setLoading] = useState(false)

  async function handleDownload() {
    setLoading(true)
    try {
      const sp = new URLSearchParams()
      sp.set('start', params.start)
      sp.set('end', params.end)
      sp.set('primary', params.primary)
      sp.set('secondary', params.secondary)
      sp.set('entryType', params.entryType)
      for (const id of params.userIds) sp.append('userIds', id)
      for (const id of params.clientIds) sp.append('clientIds', id)

      const res = await fetch(`/api/reports/timesheet?${sp.toString()}`)
      if (!res.ok) throw new Error('Error generando PDF')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename="([^"]+)"/)
      a.download = match?.[1] ?? 'hojas-de-tiempo.pdf'
      a.click()
      URL.revokeObjectURL(a.href)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className="px-5 py-2.5 bg-[#00675c] text-white font-bold rounded-full hover:bg-[#005047] transition-all text-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <span className="material-symbols-outlined text-base">
        {loading ? 'hourglass_empty' : 'download'}
      </span>
      {loading ? 'Generando…' : 'Descargar PDF'}
    </button>
  )
}
