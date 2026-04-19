import type { AdminCategory } from '@/types/db'

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function formatDayLabel(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('es-SV', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function isoDateStr(d: Date): string {
  return d.toISOString().split('T')[0]
}

export const ADMIN_CATEGORY_LABELS: Record<AdminCategory, string> = {
  administrativa:         'Administrativa',
  coordinacion_cuentas:   'Coordinación de Cuentas',
  reunion_interna:        'Reunión Interna',
  direccion_creativa:     'Dirección Creativa',
  direccion_comunicacion: 'Dirección de Comunicación',
  standby:                'Tiempo de Standby',
}

export const ADMIN_CATEGORIES: AdminCategory[] = [
  'administrativa',
  'coordinacion_cuentas',
  'reunion_interna',
  'direccion_creativa',
  'direccion_comunicacion',
  'standby',
]
