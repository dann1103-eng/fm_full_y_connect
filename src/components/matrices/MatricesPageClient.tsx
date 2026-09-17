'use client'

import { useState } from 'react'
import type { Client } from '@/types/db'
import type { MatrixListRow, MissingMatrix } from '@/lib/data/matrices'
import { MissingMatricesPanel } from './MissingMatricesPanel'
import { MatricesTable } from './MatricesTable'
import { NewMatrixDialog } from './NewMatrixDialog'

interface Props {
  rows: MatrixListRow[]
  missing: MissingMatrix[]
  clients: Client[]
}

export function MatricesPageClient({ rows, missing, clients }: Props) {
  const [dialog, setDialog] = useState<{ open: boolean; clientId?: string; periodStart?: string }>({ open: false })
  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-fm-on-surface-variant">Planificación mensual de contenidos por cliente.</p>
        <button type="button" onClick={() => setDialog({ open: true })}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}>
          <span className="material-symbols-outlined text-[18px]">add_circle</span>
          Nueva matriz
        </button>
      </div>
      <MissingMatricesPanel missing={missing} onCreate={(m) => setDialog({ open: true, clientId: m.clientId, periodStart: m.periodStart })} />
      <MatricesTable rows={rows} />
      <NewMatrixDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        clients={clients}
        initialClientId={dialog.clientId}
        initialPeriodStart={dialog.periodStart}
      />
    </>
  )
}
