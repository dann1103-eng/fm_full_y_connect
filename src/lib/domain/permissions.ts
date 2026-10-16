import type { UserRole } from '@/types/db'

export const canCreateClient      = (role: UserRole | null | undefined) => role === 'admin' || role === 'supervisor'
export const canEditClient        = (role: UserRole | null | undefined) => role === 'admin' || role === 'supervisor'
export const canDeleteClient      = (role: UserRole | null | undefined) => role === 'admin'
export const canCreateRequirement = (role: UserRole | null | undefined) => role === 'admin' || role === 'supervisor'
export const canManageMatrices    = (role: UserRole | null | undefined) => role === 'admin' || role === 'supervisor'
export const canAssignRequirements= (role: UserRole | null | undefined) => role === 'admin' || role === 'supervisor'
export const canViewReports       = (role: UserRole | null | undefined) => role === 'admin' || role === 'supervisor'
export const canViewRenewals      = (role: UserRole | null | undefined) => role === 'admin'
export const canViewPlans         = (role: UserRole | null | undefined) => role === 'admin' || role === 'supervisor'
export const canEditPlans         = (role: UserRole | null | undefined) => role === 'admin' || role === 'supervisor'
export const canViewUsers         = (role: UserRole | null | undefined) => role === 'admin'
export const canManageOthersTime  = (role: UserRole | null | undefined) => role === 'admin'
export const canMarkPayment       = (role: UserRole | null | undefined) => role === 'admin'
export const canVoidRequirement   = (role: UserRole | null | undefined) => role === 'admin'

export const isClientRole = (role: UserRole | null | undefined): role is 'client' =>
  role === 'client'

export const isStaffRole = (role: UserRole | null | undefined): boolean =>
  role === 'admin' || role === 'supervisor' || role === 'operator'

export const canAccessPortal = (role: UserRole | null | undefined): boolean =>
  isClientRole(role)

/**
 * ¿Se le muestra el aviso "¿Sigues en línea?" (y se le cierra la sesión si no responde)?
 * Aplica al staff humano. No aplica a clientes ni a usuarios con `skip_idle_prompt`
 * (agentes de IA que operan el sistema desde un navegador sin nadie delante). Si la columna
 * aún no existe en la base (migración 0132 sin aplicar), el valor llega `undefined` y el
 * aviso se mantiene: el comportamiento anterior.
 */
export const needsPresenceCheck = (
  user: { role: UserRole | null | undefined; skip_idle_prompt?: boolean | null } | null | undefined,
): boolean => !!user && user.role !== 'client' && !user.skip_idle_prompt
