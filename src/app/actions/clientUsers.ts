'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' as const, supabase: null, adminUserId: null }
  const { data: appUser } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (appUser?.role !== 'admin') {
    return { error: 'Solo admins pueden gestionar accesos de portal' as const, supabase: null, adminUserId: null }
  }
  return { error: null, supabase, adminUserId: user.id }
}

export type ClientUserActionResult = { ok: true; userId?: string } | { ok: false; error: string }

export async function createClientUser(params: {
  clientId: string
  email: string
  password: string
  fullName?: string
}): Promise<ClientUserActionResult> {
  try {
    const { clientId, email, password, fullName } = params
    const clean = email.trim().toLowerCase()
    if (!clean || !clean.includes('@')) return { ok: false, error: 'Email inválido' }
    if (!password || password.length < 8) return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres' }

    const auth = await requireAdmin()
    if (auth.error) return { ok: false, error: auth.error }

    const admin = createAdminClient()

    const { data: existing } = await admin
      .from('users')
      .select('id, role')
      .eq('email', clean)
      .maybeSingle()

    let userId: string

    if (existing) {
      if (existing.role !== 'client') {
        return {
          ok: false,
          error: `${clean} ya tiene cuenta como ${existing.role}. No se puede reutilizar este correo para un cliente.`,
        }
      }
      userId = existing.id
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password })
      if (updErr) return { ok: false, error: `No se pudo actualizar la contraseña: ${updErr.message}` }
      if (fullName) {
        await admin.from('users').update({ full_name: fullName }).eq('id', userId)
      }
    } else {
      // Antes de crear, detectar y limpiar usuarios huérfanos en auth.users
      // (existen en auth pero ya no en public.users — pasa cuando se borra un cliente sin limpiar auth)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: orphanId } = await (admin as any).rpc('get_auth_user_id_by_email', { p_email: clean }) as { data: string | null }
      if (orphanId) {
        await admin.auth.admin.deleteUser(orphanId).catch((err) =>
          console.error(`[createClientUser] No se pudo eliminar auth huérfano ${orphanId}:`, err)
        )
      }

      const { data, error } = await admin.auth.admin.createUser({
        email: clean,
        password,
        email_confirm: true,
        user_metadata: { role: 'client', full_name: fullName ?? null },
      })
      if (error || !data.user) {
        return { ok: false, error: `No se pudo crear el usuario: ${error?.message ?? 'desconocido'}` }
      }
      userId = data.user.id

      const { error: upsertErr } = await admin.from('users').upsert({
        id: userId,
        email: clean,
        full_name: fullName ?? '',
        role: 'client',
      })
      if (upsertErr) {
        await admin.auth.admin.deleteUser(userId).catch(() => undefined)
        return { ok: false, error: `No se pudo registrar el usuario: ${upsertErr.message}` }
      }
    }

    const { error: linkErr } = await admin
      .from('client_users')
      .upsert(
        { user_id: userId, client_id: clientId, role: 'owner' },
        { onConflict: 'user_id,client_id' }
      )
    if (linkErr) return { ok: false, error: `No se pudo vincular al cliente: ${linkErr.message}` }

    revalidatePath(`/clients/${clientId}`)
    return { ok: true, userId }
  } catch (e) {
    console.error('[createClientUser]', e)
    return { ok: false, error: e instanceof Error ? e.message : 'Error inesperado al crear credenciales' }
  }
}

export async function revokeClientUser(params: {
  clientId: string
  userId: string
}): Promise<ClientUserActionResult> {
  try {
    const auth = await requireAdmin()
    if (auth.error) return { ok: false, error: auth.error }

    const admin = createAdminClient()

    const { data: target } = await admin
      .from('users')
      .select('role')
      .eq('id', params.userId)
      .maybeSingle()
    if (!target) return { ok: false, error: 'Usuario no encontrado' }
    if (target.role !== 'client') {
      return { ok: false, error: 'Solo se pueden revocar accesos de clientes' }
    }

    const { error: unlinkErr } = await admin
      .from('client_users')
      .delete()
      .eq('client_id', params.clientId)
      .eq('user_id', params.userId)
    if (unlinkErr) return { ok: false, error: `No se pudo desvincular del cliente: ${unlinkErr.message}` }

    const { data: remaining } = await admin
      .from('client_users')
      .select('id')
      .eq('user_id', params.userId)
      .limit(1)

    if (!remaining || remaining.length === 0) {
      const { error: delPubErr } = await admin.from('users').delete().eq('id', params.userId)
      if (delPubErr) return { ok: false, error: `No se pudo eliminar el registro público: ${delPubErr.message}` }

      const { error: delAuthErr } = await admin.auth.admin.deleteUser(params.userId)
      if (delAuthErr) return { ok: false, error: `No se pudo eliminar la cuenta: ${delAuthErr.message}` }
    }

    revalidatePath(`/clients/${params.clientId}`)
    return { ok: true }
  } catch (e) {
    console.error('[revokeClientUser]', e)
    return { ok: false, error: e instanceof Error ? e.message : 'Error inesperado al revocar acceso' }
  }
}

export async function listClientUsers(clientId: string): Promise<Array<{
  id: string
  user_id: string
  role: string
  users: { id: string; full_name: string | null; email: string | null; role: string } | null
}>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('client_users')
    .select('id, user_id, role, created_at, users:users!inner(id, full_name, email, role)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Array<{
    id: string
    user_id: string
    role: string
    users: { id: string; full_name: string | null; email: string | null; role: string } | null
  }>
}

// ── Panel central /users/portal ──────────────────────────────────

export interface PortalUserListed {
  user_id: string
  email: string
  full_name: string
  clients: {
    id: string
    name: string
    role: 'owner' | 'viewer'
    can_billing: boolean
    can_work: boolean
  }[]
}

/** Lista todos los usuarios `role='client'` con sus marcas asignadas. */
export async function listAllClientUsers(): Promise<PortalUserListed[]> {
  const auth = await requireAdmin()
  if (auth.error) throw new Error(auth.error)
  const admin = createAdminClient()

  const { data: users, error: usersErr } = await admin
    .from('users')
    .select('id, full_name, email')
    .eq('role', 'client')
    .order('email')
  if (usersErr) throw new Error(usersErr.message)

  if (!users?.length) return []

  const userIds = users.map(u => u.id)
  const { data: links } = await admin
    .from('client_users')
    .select('user_id, role, can_billing, can_work, clients:clients!inner(id, name)')
    .in('user_id', userIds)

  const linksByUser: Record<
    string,
    { id: string; name: string; role: 'owner' | 'viewer'; can_billing: boolean; can_work: boolean }[]
  > = {}
  for (const link of (links ?? []) as unknown as Array<{
    user_id: string
    role: 'owner' | 'viewer'
    can_billing: boolean
    can_work: boolean
    clients: { id: string; name: string } | { id: string; name: string }[]
  }>) {
    if (!linksByUser[link.user_id]) linksByUser[link.user_id] = []
    const cl = Array.isArray(link.clients) ? link.clients[0] : link.clients
    if (cl) linksByUser[link.user_id].push({
      id: cl.id,
      name: cl.name,
      role: link.role,
      can_billing: link.can_billing,
      can_work: link.can_work,
    })
  }

  return users.map(u => ({
    user_id: u.id,
    email: u.email ?? '',
    full_name: u.full_name ?? '',
    clients: (linksByUser[u.id] ?? []).sort((a, b) => a.name.localeCompare(b.name)),
  }))
}

/**
 * Crea un nuevo usuario portal con acceso a múltiples marcas (clients).
 * Si el email ya existe como `role='client'`, lo reusa y agrega/actualiza vínculos.
 */
export async function createClientUserMulti(params: {
  email: string
  password: string
  fullName?: string
  clientIds: string[]
  role?: 'owner' | 'viewer'
  /** Permisos granulares aplicados a TODAS las marcas vinculadas. Default: ambos true. */
  permissions?: { can_billing: boolean; can_work: boolean }
}): Promise<ClientUserActionResult> {
  try {
    const { email, password, fullName, clientIds, role = 'owner' } = params
    const permissions = params.permissions ?? { can_billing: true, can_work: true }
    if (!permissions.can_billing && !permissions.can_work) {
      return { ok: false, error: 'Selecciona al menos un permiso (Facturación o Gestión de trabajo)' }
    }
    const clean = email.trim().toLowerCase()
    if (!clean || !clean.includes('@')) return { ok: false, error: 'Email inválido' }
    if (!password || password.length < 8) return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres' }
    if (!clientIds.length) return { ok: false, error: 'Selecciona al menos una marca' }

    const auth = await requireAdmin()
    if (auth.error) return { ok: false, error: auth.error }

    const admin = createAdminClient()

    const { data: existing } = await admin
      .from('users')
      .select('id, role')
      .eq('email', clean)
      .maybeSingle()

    let userId: string

    if (existing) {
      if (existing.role !== 'client') {
        return {
          ok: false,
          error: `${clean} ya tiene cuenta como ${existing.role}. No se puede reutilizar este correo para un cliente.`,
        }
      }
      userId = existing.id
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password })
      if (updErr) return { ok: false, error: `No se pudo actualizar la contraseña: ${updErr.message}` }
      if (fullName) {
        await admin.from('users').update({ full_name: fullName }).eq('id', userId)
      }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: orphanId } = await (admin as any).rpc('get_auth_user_id_by_email', { p_email: clean }) as { data: string | null }
      if (orphanId) {
        await admin.auth.admin.deleteUser(orphanId).catch((err) =>
          console.error(`[createClientUserMulti] No se pudo eliminar auth huérfano ${orphanId}:`, err)
        )
      }

      const { data, error } = await admin.auth.admin.createUser({
        email: clean,
        password,
        email_confirm: true,
        user_metadata: { role: 'client', full_name: fullName ?? null },
      })
      if (error || !data.user) {
        return { ok: false, error: `No se pudo crear el usuario: ${error?.message ?? 'desconocido'}` }
      }
      userId = data.user.id

      const { error: upsertErr } = await admin.from('users').upsert({
        id: userId,
        email: clean,
        full_name: fullName ?? '',
        role: 'client',
      })
      if (upsertErr) {
        await admin.auth.admin.deleteUser(userId).catch(() => undefined)
        return { ok: false, error: `No se pudo registrar el usuario: ${upsertErr.message}` }
      }
    }

    const rows = clientIds.map(cid => ({
      user_id: userId,
      client_id: cid,
      role,
      can_billing: permissions.can_billing,
      can_work: permissions.can_work,
    }))
    const { error: linkErr } = await admin
      .from('client_users')
      .upsert(rows, { onConflict: 'user_id,client_id' })
    if (linkErr) return { ok: false, error: `No se pudieron vincular las marcas: ${linkErr.message}` }

    revalidatePath('/users/portal')
    for (const cid of clientIds) revalidatePath(`/clients/${cid}`)
    return { ok: true, userId }
  } catch (e) {
    console.error('[createClientUserMulti]', e)
    return { ok: false, error: e instanceof Error ? e.message : 'Error inesperado al crear credenciales' }
  }
}

/**
 * Sincroniza las marcas asignadas a un usuario portal: agrega las nuevas y
 * remueve las que dejaron de estar en `clientIds`. Si queda con cero, NO borra
 * la cuenta — usa `revokeAllClientUser` para eso.
 */
export async function setClientUserAssignments(params: {
  userId: string
  clientIds: string[]
  role?: 'owner' | 'viewer'
  /** Permisos aplicados a las marcas. Default: ambos true. */
  permissions?: { can_billing: boolean; can_work: boolean }
}): Promise<ClientUserActionResult> {
  try {
    const { userId, clientIds, role = 'owner' } = params
    const permissions = params.permissions ?? { can_billing: true, can_work: true }
    if (clientIds.length > 0 && !permissions.can_billing && !permissions.can_work) {
      return { ok: false, error: 'Selecciona al menos un permiso (Facturación o Gestión de trabajo)' }
    }
    const auth = await requireAdmin()
    if (auth.error) return { ok: false, error: auth.error }

    const admin = createAdminClient()

    const { data: target } = await admin.from('users').select('role').eq('id', userId).maybeSingle()
    if (!target) return { ok: false, error: 'Usuario no encontrado' }
    if (target.role !== 'client') return { ok: false, error: 'Solo se pueden ajustar accesos de clientes' }

    if (clientIds.length > 0) {
      const rows = clientIds.map(cid => ({
        user_id: userId,
        client_id: cid,
        role,
        can_billing: permissions.can_billing,
        can_work: permissions.can_work,
      }))
      const { error: upErr } = await admin
        .from('client_users')
        .upsert(rows, { onConflict: 'user_id,client_id' })
      if (upErr) return { ok: false, error: `No se pudieron vincular las marcas: ${upErr.message}` }
    }

    // Eliminar vínculos que ya no están en la lista
    const { data: existing } = await admin
      .from('client_users')
      .select('client_id')
      .eq('user_id', userId)
    const toRemove = (existing ?? [])
      .map(r => r.client_id as string)
      .filter(cid => !clientIds.includes(cid))
    if (toRemove.length > 0) {
      const { error: delErr } = await admin
        .from('client_users')
        .delete()
        .eq('user_id', userId)
        .in('client_id', toRemove)
      if (delErr) return { ok: false, error: `No se pudieron remover marcas: ${delErr.message}` }
    }

    revalidatePath('/users/portal')
    return { ok: true, userId }
  } catch (e) {
    console.error('[setClientUserAssignments]', e)
    return { ok: false, error: e instanceof Error ? e.message : 'Error inesperado' }
  }
}

/**
 * Revoca todo el acceso de un usuario portal: borra todos los vínculos en
 * client_users y elimina su cuenta (auth + public).
 */
export async function revokeAllClientUser(userId: string): Promise<ClientUserActionResult> {
  try {
    const auth = await requireAdmin()
    if (auth.error) return { ok: false, error: auth.error }
    const admin = createAdminClient()

    const { data: target } = await admin.from('users').select('role').eq('id', userId).maybeSingle()
    if (!target) return { ok: false, error: 'Usuario no encontrado' }
    if (target.role !== 'client') return { ok: false, error: 'Solo se pueden revocar usuarios cliente' }

    await admin.from('client_users').delete().eq('user_id', userId)

    const { error: delPubErr } = await admin.from('users').delete().eq('id', userId)
    if (delPubErr) return { ok: false, error: `No se pudo eliminar el registro público: ${delPubErr.message}` }

    const { error: delAuthErr } = await admin.auth.admin.deleteUser(userId)
    if (delAuthErr) return { ok: false, error: `No se pudo eliminar la cuenta: ${delAuthErr.message}` }

    revalidatePath('/users/portal')
    return { ok: true, userId }
  } catch (e) {
    console.error('[revokeAllClientUser]', e)
    return { ok: false, error: e instanceof Error ? e.message : 'Error inesperado' }
  }
}
