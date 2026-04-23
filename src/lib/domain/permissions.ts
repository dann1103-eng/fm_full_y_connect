import type { UserRole } from '@/types/db'

export const canCreateClient      = (role: UserRole | null | undefined) => role === 'admin' || role === 'supervisor'
export const canEditClient        = (role: UserRole | null | undefined) => role === 'admin' || role === 'supervisor'
export const canDeleteClient      = (role: UserRole | null | undefined) => role === 'admin'
export const canCreateRequirement = (role: UserRole | null | undefined) => role === 'admin' || role === 'supervisor'
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
