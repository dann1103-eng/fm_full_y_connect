import type { MatrixStatus } from '@/types/db'
import { MATRIX_STATUS_LABELS } from '@/lib/domain/matrix'

const STATUS_CLASS: Record<MatrixStatus, string> = {
  draft: 'bg-fm-surface-container-high text-fm-on-surface-variant',
  approved: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-200',
  closed: 'bg-gray-200 text-gray-600 dark:bg-gray-500/20 dark:text-gray-300',
}

export function StatusBadge({ status }: { status: MatrixStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${STATUS_CLASS[status]}`}>
      {MATRIX_STATUS_LABELS[status]}
    </span>
  )
}
