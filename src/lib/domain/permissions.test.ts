import { describe, it, expect } from 'vitest'
import { isClientRole, isStaffRole, canAccessPortal, needsPresenceCheck } from './permissions'

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

describe('permissions — aviso de presencia', () => {
  it('el staff humano recibe el aviso por defecto', () => {
    expect(needsPresenceCheck({ role: 'admin' })).toBe(true)
    expect(needsPresenceCheck({ role: 'operator', skip_idle_prompt: false })).toBe(true)
  })

  it('un usuario marcado con skip_idle_prompt no lo recibe, tenga el rol que tenga', () => {
    expect(needsPresenceCheck({ role: 'admin', skip_idle_prompt: true })).toBe(false)
    expect(needsPresenceCheck({ role: 'supervisor', skip_idle_prompt: true })).toBe(false)
  })

  it('el cliente del portal nunca lo recibe', () => {
    expect(needsPresenceCheck({ role: 'client' })).toBe(false)
  })

  it('sin la columna en la base (undefined/null) mantiene el aviso', () => {
    expect(needsPresenceCheck({ role: 'admin', skip_idle_prompt: undefined })).toBe(true)
    expect(needsPresenceCheck({ role: 'admin', skip_idle_prompt: null })).toBe(true)
  })

  it('sin usuario no hay aviso', () => {
    expect(needsPresenceCheck(null)).toBe(false)
    expect(needsPresenceCheck(undefined)).toBe(false)
  })
})
