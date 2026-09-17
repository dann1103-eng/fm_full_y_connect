'use client'

import Image from 'next/image'
import type { MissingMatrix } from '@/lib/data/matrices'

interface Props {
  missing: MissingMatrix[]
  onCreate: (m: MissingMatrix) => void
}

const MAX_SHOWN = 8

export function MissingMatricesPanel({ missing, onCreate }: Props) {
  if (missing.length === 0) return null
  const shown = missing.slice(0, MAX_SHOWN)
  return (
    <section className="glass-panel rounded-2xl p-4 sm:p-5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="material-symbols-outlined text-fm-primary" aria-hidden="true">event_upcoming</span>
        <h2 className="text-sm font-semibold text-fm-on-surface">Sin matriz para el próximo ciclo</h2>
        <span className="text-xs text-fm-on-surface-variant">
          {missing.length} cliente{missing.length !== 1 && 's'}
          {missing.length > MAX_SHOWN && ` · mostrando ${MAX_SHOWN}`}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {shown.map((m) => (
          <div key={m.clientId} className="flex items-center gap-3 rounded-xl border border-fm-surface-container-high bg-fm-surface-container-low px-3 py-2">
            {m.logoUrl
              ? <Image src={m.logoUrl} alt="" width={28} height={28} unoptimized className="rounded-full object-cover h-7 w-7 flex-shrink-0" />
              : <span className="h-7 w-7 flex-shrink-0 rounded-full bg-fm-primary/15 text-fm-primary text-xs font-bold flex items-center justify-center">{m.clientName.slice(0, 1).toUpperCase()}</span>}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fm-on-surface truncate">{m.clientName}</p>
              <p className="text-[11px] text-fm-on-surface-variant truncate">{m.label}</p>
            </div>
            <button type="button" onClick={() => onCreate(m)} aria-label={`Crear matriz para ${m.clientName}`}
              className="text-xs font-semibold text-fm-primary hover:underline whitespace-nowrap">Crear</button>
          </div>
        ))}
      </div>
    </section>
  )
}
