export type DateRangePreset = 'day' | 'week' | 'month' | 'custom'

export interface DateRangeValue {
  start: string
  end: string
  preset: DateRangePreset
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function dayRange(now = new Date()): DateRangeValue {
  const start = startOfDay(now)
  const end = addDays(start, 1)
  return { start: start.toISOString(), end: end.toISOString(), preset: 'day' }
}

export function weekRange(now = new Date()): DateRangeValue {
  const today = startOfDay(now)
  const dayOfWeek = (today.getDay() + 6) % 7
  const start = addDays(today, -dayOfWeek)
  const end = addDays(start, 7)
  return { start: start.toISOString(), end: end.toISOString(), preset: 'week' }
}

export function monthRange(now = new Date()): DateRangeValue {
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return { start: start.toISOString(), end: end.toISOString(), preset: 'month' }
}
