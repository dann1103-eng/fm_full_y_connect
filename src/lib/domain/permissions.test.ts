import { describe, it, expect } from 'vitest'
import { isClientRole, isStaffRole, canAccessPortal } from './permissions'

describe('permissions — roles de portal', () => {
  it('isClientRole detecta solo role=client', () => {
    expect(isClientRole('client')).toBe(true)
    expect(isClientRole('admin')).toBe(false)
    expect(isClientRole('supervisor')).toBe(false)
    expect(isClientRole('operator')).toBe(false)
    expect(isClientRole(null)).toBe(false)
    expect(isClientRole(undefined)).toBe(false)
  })

  it('isStaffRole detecta admin/supervisor/operator', () => {
    expect(isStaffRole('admin')).toBe(true)
    expect(isStaffRole('supervisor')).toBe(true)
    expect(isStaffRole('operator')).toBe(true)
    expect(isStaffRole('client')).toBe(false)
    expect(isStaffRole(null)).toBe(false)
  })

  it('canAccessPortal es equivalente a isClientRole', () => {
    expect(canAccessPortal('client')).toBe(true)
    expect(canAccessPortal('admin')).toBe(false)
  })
})
