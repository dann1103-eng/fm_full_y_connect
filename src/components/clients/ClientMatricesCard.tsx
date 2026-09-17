'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { Client } from '@/types/db'
import type { ClientMatrixSummary } from '@/lib/data/matrices'
import type { TargetPeriod } from '@/lib/domain/matrix'
import { StatusBadge } from '@/components/matrices/StatusBadge'
import { NewMatrixDialog } from '@/components/matrices/NewMatrixDialog'

interface Props {
  client: Client
  periods: TargetPeriod[]
  matrices: ClientMatrixSummary[]
}

export function ClientMatricesCard({ client, periods, matrices }: Props) {
  const [dialog, setDialog] = useState<{ open: boolean; periodStart?: string }>({ open: false })
  return (
    <section className="glass-panel rounded-[2rem] p-4 sm:p-6 space-y-3">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-fm-primary" aria-hidden="true">grid_view</span>
        <h3 className="text-base font-semibold text-fm-on-surface">Matrices de contenido</h3>
        <Link href="/matrices" className="ml-auto text-xs font-semibold text-fm-primary hover:underline">Ver todas</Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {periods.map((p) => {
          const m = matrices.find((x) => x.periodStart === p.periodStart)
          return (
            <div key={p.periodStart} className="rounded-xl border border-fm-surface-container-high bg-fm-surface-container-low p-4 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-fm-primary">{p.isCurrent ? 'Ciclo vigente' : 'Próximo ciclo'}</p>
              <p className="text-xs text-fm-on-surface-variant">{p.label}</p>
              {m ? (
                <>
                  <div className="flex items-center gap-2">
                    <Link href={`/matrices/${m.id}`} className="text-sm font-semibold text-fm-on-surface hover:underline truncate">{m.title}</Link>
                    <StatusBadge status={m.status} />
                  </div>
                  <p className="text-[11px] text-fm-on-surface-variant">{m.itemCount} pieza{m.itemCount !== 1 && 's'}</p>
                </>
              ) : (
                <button type="button" onClick={() => setDialog({ open: true, periodStart: p.periodStart })}
                  className="text-sm font-semibold text-fm-primary hover:underline">+ Crear matriz</button>
              )}
            </div>
          )
        })}
      </div>
      <NewMatrixDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        clients={[client]}
        initialClientId={client.id}
        initialPeriodStart={dialog.periodStart}
        lockClient
      />
    </section>
  )
}
