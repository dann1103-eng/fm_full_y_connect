import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { TopNav } from '@/components/layout/TopNav'
import { TaskManagerPanel } from '@/components/tareas/TaskManagerPanel'
import { MyTasksPanel } from '@/components/tareas/MyTasksPanel'
import type { TaskStaffUser, TaskVM } from '@/components/tareas/types'
import type { AssignedTask, TimeEntry } from '@/types/db'

export const dynamic = 'force-dynamic'

type TaskWithNames = AssignedTask & {
  assignee: { id: string; full_name: string; avatar_url: string | null } | null
  creator: { id: string; full_name: string } | null
}

/** Suma duration_seconds por task_id a partir de filas planas de time_entries. */
function secondsByTask(rows: { task_id: string | null; duration_seconds: number | null }[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const r of rows) {
    if (!r.task_id) continue
    map.set(r.task_id, (map.get(r.task_id) ?? 0) + (r.duration_seconds ?? 0))
  }
  return map
}

function toVM(t: TaskWithNames, secs: Map<string, number>): TaskVM {
  return {
    ...t,
    assignee_name: t.assignee?.full_name ?? 'Sin asignar',
    assignee_avatar: t.assignee?.avatar_url ?? null,
    creator_name: t.creator?.full_name ?? '—',
    seconds: secs.get(t.id) ?? 0,
  }
}

const TASK_SELECT = `*,
  assignee:users!assigned_tasks_assigned_to_user_id_fkey(id, full_name, avatar_url),
  creator:users!assigned_tasks_created_by_user_id_fkey(id, full_name)`

export default async function TareasPage() {
  const ctx = await getEffectiveUser()
  if (!ctx) redirect('/login')

  const appUser = ctx.appUser
  const isManager = appUser.role === 'admin' || appUser.role === 'supervisor'
  // Manager o suplantación → admin client (lectura cross-user sin fricción de RLS).
  // Operador real → cliente normal (RLS lo acota a lo suyo).
  const db = isManager || ctx.isImpersonating ? createAdminClient() : await createClient()

  if (isManager) {
    const { data: tasksRaw } = await db
      .from('assigned_tasks')
      .select(TASK_SELECT)
      .order('created_at', { ascending: false })
    const tasks = (tasksRaw ?? []) as unknown as TaskWithNames[]

    const taskIds = tasks.map((t) => t.id)
    let secs = new Map<string, number>()
    if (taskIds.length > 0) {
      const { data: durs } = await db
        .from('time_entries')
        .select('task_id, duration_seconds')
        .in('task_id', taskIds)
      secs = secondsByTask((durs ?? []) as { task_id: string | null; duration_seconds: number | null }[])
    }

    const { data: usersRaw } = await db
      .from('users')
      .select('id, full_name, avatar_url, role')
      .not('role', 'in', '(client,agent)')
      .order('full_name')
    const staff = (usersRaw ?? []) as TaskStaffUser[]

    return (
      <div className="flex flex-col min-h-full">
        <TopNav title="Tareas" />
        <div className="flex-1 p-6 max-w-6xl mx-auto w-full">
          <TaskManagerPanel
            initialTasks={tasks.map((t) => toVM(t, secs))}
            staff={staff}
            currentUserId={appUser.id}
          />
        </div>
      </div>
    )
  }

  // ── Vista operador: "Mis tasks" ────────────────────────────────────────────
  const me = appUser.id
  const { data: myTasksRaw } = await db
    .from('assigned_tasks')
    .select(TASK_SELECT)
    .eq('assigned_to_user_id', me)
    .order('created_at', { ascending: false })
  const myTasks = (myTasksRaw ?? []) as unknown as TaskWithNames[]

  const taskIds = myTasks.map((t) => t.id)
  let secs = new Map<string, number>()
  if (taskIds.length > 0) {
    const { data: durs } = await db
      .from('time_entries')
      .select('task_id, duration_seconds')
      .eq('user_id', me)
      .in('task_id', taskIds)
    secs = secondsByTask((durs ?? []) as { task_id: string | null; duration_seconds: number | null }[])
  }

  const { data: activeRaw } = await db
    .from('time_entries')
    .select('*')
    .eq('user_id', me)
    .is('ended_at', null)
    .maybeSingle()
  const activeEntry = (activeRaw as TimeEntry | null) ?? null

  const vms = myTasks.map((t) => toVM(t, secs))
  const activos = vms.filter((t) => t.status === 'pending' || t.status === 'in_progress')
  const historial = vms.filter((t) => t.status === 'done' || t.status === 'cancelled')

  return (
    <div className="flex flex-col min-h-full">
      <TopNav title="Mis tasks" />
      <div className="flex-1 p-6 max-w-4xl mx-auto w-full">
        <MyTasksPanel
          activos={activos}
          historial={historial}
          activeEntry={activeEntry}
          disabled={ctx.isImpersonating}
        />
      </div>
    </div>
  )
}
