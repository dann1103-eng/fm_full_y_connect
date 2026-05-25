import { createClient } from '@/lib/supabase/server'
import { assertNotImpersonating } from '@/app/actions/impersonation'
import { getActiveClientId } from '@/lib/supabase/active-client'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/db'

type Role = 'admin' | 'supervisor' | 'operator' | 'client' | 'agent'

export interface AuthContext {
  supabase: SupabaseClient<Database>
  userId: string
  role: Role
}

export interface PortalAuthContext extends AuthContext {
  activeClientId: string
}

interface AuthOptions {
  /**
   * Por defecto rechazamos requests en modo espectador (admin suplantando).
   * Pasar `true` solo en lecturas explícitamente seguras de mostrar al admin.
   */
  allowImpersonation?: boolean
}

/**
 * Verifica que la request tenga una sesión válida y retorna el contexto.
 * Lanza si no hay auth, si el usuario no existe en `users`, o si está en modo
 * espectador (a menos que `allowImpersonation` sea true).
 *
 * Es el punto de entrada canónico para toda Server Action. Reemplaza el patrón
 * `getCurrentUser()` duplicado en cada archivo.
 */
export async function requireUser(opts?: AuthOptions): Promise<AuthContext> {
  if (!opts?.allowImpersonation) {
    await assertNotImpersonating()
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')

  const { data: appUser } = await supabase
    .from('users')
    .select('id, role')
    .eq('id', user.id)
    .single()
  if (!appUser) throw new Error('Usuario no encontrado')

  return { supabase, userId: appUser.id, role: appUser.role as Role }
}

/** Como requireUser pero exige `role === 'admin'`. */
export async function requireAdmin(opts?: AuthOptions): Promise<AuthContext> {
  const ctx = await requireUser(opts)
  if (ctx.role !== 'admin') throw new Error('Sin permisos de admin')
  return ctx
}

/** Como requireUser pero exige `role IN ('admin', 'supervisor')`. */
export async function requireAdminOrSupervisor(opts?: AuthOptions): Promise<AuthContext> {
  const ctx = await requireUser(opts)
  if (ctx.role !== 'admin' && ctx.role !== 'supervisor') {
    throw new Error('Sin permisos (admin o supervisor requerido)')
  }
  return ctx
}

/**
 * Para Server Actions del portal del cliente. Exige sesión + cliente activo
 * en cookie. No valida `role === 'client'` porque admins pueden actuar sobre
 * el portal vía impersonation (allowImpersonation: true) si la action lo
 * permite explícitamente.
 */
export async function requirePortalClient(opts?: AuthOptions): Promise<PortalAuthContext> {
  const ctx = await requireUser(opts)
  const activeClientId = await getActiveClientId()
  if (!activeClientId) throw new Error('No hay cliente activo seleccionado')
  return { ...ctx, activeClientId }
}
