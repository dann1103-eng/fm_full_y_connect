'use client'

import { useMemo, useState } from 'react'
import type { Client } from '@/types/db'
import type { MatrixListRow, MissingMatrix } from '@/lib/data/matrices'
import { MissingMatricesPanel } from './MissingMatricesPanel'
import { MatricesTable } from './MatricesTable'
import { NewMatrixDialog } from './NewMatrixDialog'

/** Estados de cliente a los que se les puede crear una matriz desde el diálogo. */
const CREATABLE_STATUSES: Client['status'][] = ['active', 'paused', 'overdue']

interface Props {
  rows: MatrixListRow[]
  missing: MissingMatrix[]
  /** Todos los clientes (el filtro de la tabla toma los que tienen matrices). */
  clients: Client[]
}

export function MatricesPageClient({ rows, missing, clients }: Props) {
  const [dialog, setDialog] = useState<{ open: boolean; clientId?: string; periodStart?: string }>({ open: false })
  const creatableClients = useMemo(() => clients.filter((c) => CREATABLE_STATUSES.includes(c.status)), [clients])
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
      <MatricesTable rows={rows} clients={clients} />
      <NewMatrixDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        clients={creatableClients}
        initialClientId={dialog.clientId}
        initialPeriodStart={dialog.periodStart}
      />
    </>
  )
}
