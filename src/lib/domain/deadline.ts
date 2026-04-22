import type { Phase } from '@/types/db'

export type DeadlineStatus = 'none' | 'green' | 'yellow' | 'amber' | 'red' | 'overdue'

const TERMINAL_PHASES: Phase[] = ['publicado_entregado']

export function getDeadlineStatus(
  deadline: string | null | undefined,
  phase: Phase,
  now: Date = new Date(),
): { status: DeadlineStatus; daysLeft: number | null } {
  if (!deadline) return { status: 'none', daysLeft: null }

  const deadlineDay = new Date(`${deadline}T00:00:00`)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((deadlineDay.getTime() - today.getTime()) / 86400000)

  if (diffDays < 0) {
    if (TERMINAL_PHASES.includes(phase)) {
      return { status: 'none', daysLeft: diffDays }
    }
    return { status: 'overdue', daysLeft: diffDays }
  }
  if (diffDays <= 1) return { status: 'red', daysLeft: diffDays }
  if (diffDays <= 3) return { status: 'amber', daysLeft: diffDays }
  if (diffDays <= 7) return { status: 'yellow', daysLeft: diffDays }
  return { status: 'green', daysLeft: diffDays }
}

export function deadlineIconClasses(status: DeadlineStatus): string {
  switch (status) {
    case 'green':
      return 'bg-green-100 text-green-700 dark:bg-green-500/25 dark:text-green-200'
    case 'yellow':
      return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/25 dark:text-yellow-200'
    case 'amber':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-500/25 dark:text-orange-200'
    case 'red':
      return 'bg-red-100 text-red-700 dark:bg-red-500/25 dark:text-red-200'
    case 'overdue':
      return 'bg-fm-error text-white'
    default:
      return 'bg-gray-100 text-gray-500 dark:bg-gray-500/20 dark:text-gray-300'
  }
}

export function deadlineChipClasses(status: DeadlineStatus): string {
  switch (status) {
    case 'green':
      return 'bg-green-100 text-green-700 border-green-200 dark:bg-green-500/20 dark:text-green-200 dark:border-green-400/30'
    case 'yellow':
      return 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-500/20 dark:text-yellow-200 dark:border-yellow-400/30'
    case 'amber':
      return 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/20 dark:text-orange-200 dark:border-orange-400/30'
    case 'red':
      return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-500/20 dark:text-red-200 dark:border-red-400/30'
    case 'overdue':
      return 'bg-fm-error text-white border-fm-error'
    default:
      return 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-500/20 dark:text-gray-300 dark:border-gray-400/30'
  }
}

export function formatDeadlineLabel(daysLeft: number): string {
  if (daysLeft < 0) return `vencido ${Math.abs(daysLeft)}d`
  if (daysLeft === 0) return 'hoy'
  if (daysLeft === 1) return 'mañana'
  return `en ${daysLeft}d`
}

const MONTHS_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
]

export function formatDeadlineDate(deadline: string): string {
  const d = new Date(`${deadline}T12:00:00`)
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
}

/** Short badge format: "abr 20", "oct 19" — month first for inline display */
export function formatDeadlineBadge(deadline: string): string {
  const d = new Date(`${deadline}T12:00:00`)
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
}
