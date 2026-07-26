import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { getActiveClientId } from '@/lib/supabase/active-client'
import type { ClientPortalCapability } from '@/types/db'

export interface PortalPermissions {
  can_billing: boolean
  can_work: boolean
}

/**
 * Lee los permisos granulares (can_billing, can_work) del usuario actual
 * sobre el cliente activo. Usa admin client para bypass RLS — los flags
 * son metadata del rol, no datos sensibles.
 *
 * Si el usuario está siendo suplantado por un admin, le otorga ambos
 * permisos (el admin puede ver todo el portal).
 */
export async function loadPortalPermissions(
  userId: string,
  clientId: string,
  isImpersonating: boolean,
): Promise<PortalPermissions> {
  if (isImpersonating) {
    return { can_billing: true, can_work: true }
  }
  const admin = createAdminClient()
  const { data } = await admin
    .from('client_users')
    .select('can_billing, can_work')
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .maybeSingle()
  return {
    can_billing: data?.can_billing ?? false,
    can_work: data?.can_work ?? false,
  }
}

/**
 * Para usar en server components de páginas del portal. Si el usuario no
 * tiene la capacidad requerida sobre el cliente activo, redirige a
 * `/portal/sin-acceso`.
 */
export async function requirePortalCapability(
  capability: ClientPortalCapability,
): Promise<PortalPermissions> {
  const ctx = await getEffectiveUser()
  if (!ctx) redirect('/login')
  const activeClientId = await getActiveClientId()
  if (!activeClientId) redirect('/login')

  const permissions = await loadPortalPermissions(
    ctx.appUser.id,
    activeClientId,
    ctx.isImpersonating,
  )

  const has = capability === 'billing' ? permissions.can_billing : permissions.can_work
  if (!has) redirect('/portal/sin-acceso')

  return permissions
}
