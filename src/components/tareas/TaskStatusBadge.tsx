import { TASK_STATUS_LABELS, TASK_STATUS_COLORS } from '@/types/db'
import type { TaskStatus } from '@/types/db'

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ color: TASK_STATUS_COLORS[status], backgroundColor: `${TASK_STATUS_COLORS[status]}1a` }}
    >
      {TASK_STATUS_LABELS[status]}
    </span>
  )
}
