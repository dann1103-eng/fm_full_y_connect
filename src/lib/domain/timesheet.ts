import type { AdminCategory, Phase } from '@/types/db'
import { ADMIN_CATEGORY_LABELS } from './time'

export type PrimaryGroup = 'member' | 'client'
export type SecondaryGroup = 'client' | 'member' | 'requirement' | 'entry'
export type EntryTypeFilter = 'all' | 'requirement' | 'administrative'

export interface TimesheetEntry {
  id: string
  user_id: string
  user_name: string
  user_avatar_url: string | null
  client_id: string | null
  client_name: string | null
  requirement_id: string | null
  requirement_title: string | null
  entry_type: 'requirement' | 'administrative'
  category: AdminCategory | null
  phase: Phase | null
  title: string
  started_at: string
  ended_at: string | null
  duration_seconds: number
  notes: string | null
}

export interface TimesheetGroup {
  key: string
  label: string
  durationSeconds: number
  percentage: number
  children: TimesheetGroup[] | TimesheetEntry[]
  meta?: {
    requirement_id?: string
    client_id?: string
    user_id?: string
    kind?: 'member' | 'client' | 'requirement' | 'admin_category'
    avatar_url?: string | null
    category?: AdminCategory
  }
}

function isEntries(c: TimesheetGroup['children']): c is TimesheetEntry[] {
  return c.length === 0 || !('children' in (c as unknown as { children: unknown }[])[0])
}

/** Secondary group options allowed for each primary. */
export function secondaryOptionsFor(primary: PrimaryGroup): SecondaryGroup[] {
  if (primary === 'member') return ['client', 'requirement', 'entry']
  return ['member', 'requirement', 'entry']
}

function keyForPrimary(primary: PrimaryGroup, e: TimesheetEntry): { key: string; label: string; meta: TimesheetGroup['meta'] } {
  if (primary === 'member') {
    return {
      key: `m:${e.user_id}`,
      label: e.user_name || '— Sin nombre —',
      meta: { user_id: e.user_id, kind: 'member', avatar_url: e.user_avatar_url },
    }
  }
  // client
  if (!e.client_id) {
    return {
      key: 'c:none',
      label: 'Interno FM',
      meta: { kind: 'client' },
    }
  }
  return {
    key: `c:${e.client_id}`,
    label: e.client_name || '— Sin nombre —',
    meta: { client_id: e.client_id, kind: 'client' },
  }
}

function keyForSecondary(secondary: SecondaryGroup, e: TimesheetEntry): { key: string; label: string; meta: TimesheetGroup['meta'] } {
  if (secondary === 'client') {
    if (!e.client_id) return { key: 'c:none', label: 'Interno FM', meta: { kind: 'client' } }
    return { key: `c:${e.client_id}`, label: e.client_name ?? '—', meta: { client_id: e.client_id, kind: 'client' } }
  }
  if (secondary === 'member') {
    return { key: `m:${e.user_id}`, label: e.user_name, meta: { user_id: e.user_id, kind: 'member', avatar_url: e.user_avatar_url } }
  }
  // requirement
  if (e.entry_type === 'administrative') {
    const cat = e.category
    return {
      key: `admin:${cat ?? 'other'}`,
      label: cat ? `— Administrativo · ${ADMIN_CATEGORY_LABELS[cat]} —` : '— Administrativo —',
      meta: { kind: 'admin_category', category: cat ?? undefined },
    }
  }
  if (!e.requirement_id) {
    return { key: 'r:none', label: '— Sin requerimiento —', meta: { kind: 'requirement' } }
  }
  return {
    key: `r:${e.requirement_id}`,
    label: e.requirement_title || e.title || '— Requerimiento sin título —',
    meta: { requirement_id: e.requirement_id, kind: 'requirement', client_id: e.client_id ?? undefined },
  }
}

export function buildTimesheetTree(
  entries: TimesheetEntry[],
  primary: PrimaryGroup,
  secondary: SecondaryGroup,
): { groups: TimesheetGroup[]; totalSeconds: number } {
  const totalSeconds = entries.reduce((sum, e) => sum + (e.duration_seconds || 0), 0)

  // Bucket by primary
  interface PrimaryBucket {
    key: string
    label: string
    meta: TimesheetGroup['meta']
    entries: TimesheetEntry[]
  }
  const primaryMap = new Map<string, PrimaryBucket>()
  for (const e of entries) {
    const { key, label, meta } = keyForPrimary(primary, e)
    let bucket = primaryMap.get(key)
    if (!bucket) {
      bucket = { key, label, meta, entries: [] }
      primaryMap.set(key, bucket)
    }
    bucket.entries.push(e)
  }

  const groups: TimesheetGroup[] = []

  for (const bucket of primaryMap.values()) {
    const bucketDuration = bucket.entries.reduce((sum, e) => sum + (e.duration_seconds || 0), 0)

    let children: TimesheetGroup[] | TimesheetEntry[]
    if (secondary === 'entry') {
      // Direct list of entries sorted by duration desc
      children = [...bucket.entries].sort((a, b) => (b.duration_seconds || 0) - (a.duration_seconds || 0))
    } else {
      // Bucket by secondary
      interface SecondaryBucket {
        key: string
        label: string
        meta: TimesheetGroup['meta']
        entries: TimesheetEntry[]
      }
      const secondaryMap = new Map<string, SecondaryBucket>()
      for (const e of bucket.entries) {
        const { key, label, meta } = keyForSecondary(secondary, e)
        let sub = secondaryMap.get(key)
        if (!sub) {
          sub = { key, label, meta, entries: [] }
          secondaryMap.set(key, sub)
        }
        sub.entries.push(e)
      }
      const subGroups: TimesheetGroup[] = []
      for (const sub of secondaryMap.values()) {
        const subDuration = sub.entries.reduce((sum, e) => sum + (e.duration_seconds || 0), 0)
        const sortedEntries = [...sub.entries].sort(
          (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
        )
        subGroups.push({
          key: `${bucket.key}__${sub.key}`,
          label: sub.label,
          durationSeconds: subDuration,
          percentage: bucketDuration > 0 ? (subDuration / bucketDuration) * 100 : 0,
          children: sortedEntries,
          meta: sub.meta,
        })
      }
      subGroups.sort((a, b) => b.durationSeconds - a.durationSeconds)
      children = subGroups
    }

    groups.push({
      key: bucket.key,
      label: bucket.label,
      durationSeconds: bucketDuration,
      percentage: totalSeconds > 0 ? (bucketDuration / totalSeconds) * 100 : 0,
      children,
      meta: bucket.meta,
    })
  }

  groups.sort((a, b) => b.durationSeconds - a.durationSeconds)

  return { groups, totalSeconds }
}

export { isEntries }

/**
 * Cuenta cuántos valores distintos del eje `secondary` aparecen para cada
 * primary-id (user_id o client_id), en base a una lista de entries.
 *
 * Ej: `childCountsByPrimary(entries, 'member', 'requirement')` devuelve
 * `{ [user_id]: distinctRequirementCount }` — útil para mostrar "Juan · 5 requerimientos"
 * en los filtros del reporte.
 *
 * Cuando `secondary === 'entry'`, devuelve el total de entries por primary.
 * Cuando `primary === secondary` (ej. member/member), cuenta 1 por grupo.
 */
export function childCountsByPrimary(
  entries: TimesheetEntry[],
  primary: PrimaryGroup,
  secondary: SecondaryGroup,
): Record<string, number> {
  const counts: Record<string, number> = {}
  const sets: Record<string, Set<string>> = {}

  function primaryId(e: TimesheetEntry): string | null {
    if (primary === 'member') return e.user_id
    return e.client_id ?? '__internal__'
  }

  function secondaryValue(e: TimesheetEntry): string {
    switch (secondary) {
      case 'client':
        return e.client_id ?? '__internal__'
      case 'member':
        return e.user_id
      case 'requirement':
        if (e.entry_type === 'administrative') return `admin:${e.category ?? 'other'}`
        return e.requirement_id ?? '__no_req__'
      case 'entry':
        return e.id
    }
  }

  for (const e of entries) {
    const pid = primaryId(e)
    if (!pid) continue
    if (secondary === 'entry') {
      counts[pid] = (counts[pid] ?? 0) + 1
      continue
    }
    if (!sets[pid]) sets[pid] = new Set()
    sets[pid].add(secondaryValue(e))
  }

  if (secondary !== 'entry') {
    for (const [pid, s] of Object.entries(sets)) {
      counts[pid] = s.size
    }
  }

  return counts
}

/** Palabra para mostrar junto al count según el `secondary`. */
export function wordForSecondary(secondary: SecondaryGroup, count: number): string {
  const plural = count !== 1
  switch (secondary) {
    case 'client':      return plural ? 'clientes' : 'cliente'
    case 'member':      return plural ? 'miembros' : 'miembro'
    case 'requirement': return plural ? 'requerimientos' : 'requerimiento'
    case 'entry':       return plural ? 'entradas' : 'entrada'
  }
}
