import type { AssignedTask } from '@/types/db'

/** Persona mínima para dropdowns de asignación. */
export interface TaskStaffUser {
  id: string
  full_name: string
  avatar_url: string | null
  role: string
}

/** Tarea + datos derivados para render (nombres + horas acumuladas). */
export interface TaskVM extends AssignedTask {
  assignee_name: string
  assignee_avatar: string | null
  creator_name: string
  /** Suma de duration_seconds de todas las time_entries de la tarea. */
  seconds: number
}
