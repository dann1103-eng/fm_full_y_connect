import {
  parseISO,
  format,
  addMonths as dfAddMonths,
  subDays,
  addDays as dfAddDays,
  lastDayOfMonth,
  isBefore,
  differenceInCalendarDays,
} from 'date-fns'

export type DateString = string

export function parseDate(d: DateString): Date {
  return parseISO(d)
}

export function formatDate(d: Date): DateString {
  return format(d, 'yyyy-MM-dd')
}

export function today(): DateString {
  return formatDate(new Date())
}

export function addMonthsClamped(d: DateString, months: number): DateString {
  const date = parseDate(d)
  const originalDay = date.getDate()
  const shifted = dfAddMonths(date, months)
  const lastDayShifted = lastDayOfMonth(shifted).getDate()
  if (originalDay > lastDayShifted) shifted.setDate(lastDayShifted)
  return formatDate(shifted)
}

export function subtractDay(d: DateString): DateString {
  return formatDate(subDays(parseDate(d), 1))
}

export function addDay(d: DateString): DateString {
  return formatDate(dfAddDays(parseDate(d), 1))
}

export function addDaysString(d: DateString, n: number): DateString {
  return formatDate(dfAddDays(parseDate(d), n))
}

export function isBeforeDate(a: DateString, b: DateString): boolean {
  return isBefore(parseDate(a), parseDate(b))
}

export function daysBetween(a: DateString, b: DateString): number {
  return differenceInCalendarDays(parseDate(b), parseDate(a))
}

export function dayOfMonth(d: DateString): number {
  return parseDate(d).getDate()
}

export function formatDateEs(d: DateString, opts?: { withYear?: boolean }): string {
  const date = parseDate(d)
  return date.toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    ...(opts?.withYear !== false ? { year: 'numeric' } : {}),
  })
}

export function lastDayOfMonthFor(d: DateString): DateString {
  return formatDate(lastDayOfMonth(parseDate(d)))
}
