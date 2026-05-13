import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { SolicitudesList } from './SolicitudesList'
import type { ClientRequestAttachment, ClientRequestLink } from '@/types/db'

export const dynamic = 'force-dynamic'

interface PendingRow {
  id: string
  title: string
  notes: string | null
  content_type: string
  client_requested_deadline: string | null
  starts_at: string | null
  deadline: string | null
  registered_at: string
  requested_by_user_id: string | null
  billing_cycle_id: string
  client_request_attachments_json: ClientRequestAttachment[] | null
  client_request_links_json: ClientRequestLink[] | null
}

export default async function SolicitudesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: appUser } = await supabase.from('users').select('role').eq('id', user.id).single()
  const role = appUser?.role
  if (role !== 'admin' && role !== 'supervisor') redirect('/')

  const { data: rows } = await supabase
    .from('requirements')
    .select('id, title, notes, content_type, client_requested_deadline, starts_at, deadline, requested_by_user_id, billing_cycle_id, registered_at, client_request_attachments_json, client_request_links_json')
    .eq('approval_status', 'pending')
    .order('registered_at', { ascending: false })

  const pending = (rows ?? []) as unknown as PendingRow[]

  // Resolver client name vía billing_cycles → clients
  const cycleIds = Array.from(new Set(pending.map((r) => r.billing_cycle_id)))
  const userIds = Array.from(
    new Set(pending.map((r) => r.requested_by_user_id).filter((id): id is string => !!id)),
  )

  const [{ data: cycles }, { data: requesters }, { data: assignableRows }] = await Promise.all([
    cycleIds.length > 0
      ? supabase
          .from('billing_cycles')
          .select('id, client_id, clients:clients!inner(id, name)')
          .in('id', cycleIds)
      : Promise.resolve({ data: [] as Array<{
          id: string
          client_id: string
          clients: { id: string; name: string } | { id: string; name: string }[]
        }> }),
    userIds.length > 0
      ? supabase.from('users').select('id, full_name').in('id', userIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
    supabase.from('users').select('id, full_name').in('role', ['admin', 'supervisor', 'operator']).order('full_name'),
  ])

  const clientByCycle = new Map<string, { id: string; name: string }>()
  for (const c of (cycles ?? []) as Array<{
    id: string
    client_id: string
    clients: { id: string; name: string } | { id: string; name: string }[]
  }>) {
    const cl = Array.isArray(c.clients) ? c.clients[0] : c.clients
    if (cl) clientByCycle.set(c.id, cl)
  }

  const requesterById = new Map<string, string>()
  for (const r of (requesters ?? []) as Array<{ id: string; full_name: string }>) {
    requesterById.set(r.id, r.full_name)
  }

  const assignable = ((assignableRows ?? []) as Array<{ id: string; full_name: string }>)
    .map((u) => ({ id: u.id, full_name: u.full_name ?? '—' }))

  const items = pending.map((p) => {
    const client = clientByCycle.get(p.billing_cycle_id)
    return {
      id: p.id,
      title: p.title,
      notes: p.notes,
      content_type: p.content_type,
      client_requested_deadline: p.client_requested_deadline,
      starts_at: p.starts_at,
      deadline: p.deadline,
      created_at: p.registered_at,
      client_name: client?.name ?? 'Cliente desconocido',
      requested_by_name: p.requested_by_user_id
        ? requesterById.get(p.requested_by_user_id) ?? 'Usuario'
        : 'Usuario',
      client_request_attachments_json: p.client_request_attachments_json,
      client_request_links_json: p.client_request_links_json,
    }
  })

  return (
    <div className="flex flex-col min-h-full">
      <TopNav title="Solicitudes pendientes" backHref="/dashboard" />
      <div className="flex-1 p-6 space-y-4">
        <p className="text-sm text-fm-on-surface-variant">
          Reuniones y producciones solicitadas por clientes desde el portal. Aprueba para
          completar los detalles (horario, asignados, duración) y agendarla en el calendario,
          o rechaza con un motivo.
        </p>
        <SolicitudesList items={items} assignableUsers={assignable} isAdmin={role === 'admin'} />
      </div>
    </div>
  )
}
