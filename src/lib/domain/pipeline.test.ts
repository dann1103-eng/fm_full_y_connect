import { describe, it, expect } from 'vitest'
import { canRequestChangeForPhase } from './pipeline'

describe('canRequestChangeForPhase', () => {
  it('permite cambios en fases de trabajo y revisión', () => {
    expect(canRequestChangeForPhase('revision_cliente')).toBe(true)
    expect(canRequestChangeForPhase('proceso_diseno')).toBe(true)
    expect(canRequestChangeForPhase('pendiente')).toBe(true)
  })
  it('bloquea cambios en fases finales', () => {
    expect(canRequestChangeForPhase('aprobado')).toBe(false)
    expect(canRequestChangeForPhase('pendiente_publicar')).toBe(false)
    expect(canRequestChangeForPhase('publicado_entregado')).toBe(false)
  })
})
