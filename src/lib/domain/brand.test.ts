import { describe, it, expect } from 'vitest'
import {
  hasUsableBrandProfile, validateBrandPatch, BRAND_TEXT_LIMITS, BRAND_PERSONS,
  BRAND_MAX_HASHTAGS, BRAND_MAX_SAMPLE_COPIES,
} from './brand'
import type { ClientBrandProfile } from '@/types/db'

function profile(over: Partial<ClientBrandProfile> = {}): ClientBrandProfile {
  return {
    client_id: 'c1',
    tone: 'Cercano pero profesional',
    person: 'voseo',
    audience: 'Dueños de pymes en San Salvador',
    value_proposition: 'Contenido que vende sin sonar a publicidad',
    offerings: 'Plan mensual de contenido, pauta, fotografía',
    avoid: null,
    base_hashtags: null,
    sample_copies: null,
    updated_by_user_id: null,
    created_at: '2026-09-17T00:00:00Z',
    updated_at: '2026-09-17T00:00:00Z',
    ...over,
  }
}

describe('hasUsableBrandProfile', () => {
  it('true con los cuatro campos obligatorios llenos', () => {
    expect(hasUsableBrandProfile(profile())).toBe(true)
  })

  it('false sin perfil', () => {
    expect(hasUsableBrandProfile(null)).toBe(false)
    expect(hasUsableBrandProfile(undefined)).toBe(false)
  })

  it('false si falta cualquiera de los cuatro', () => {
    expect(hasUsableBrandProfile(profile({ tone: null }))).toBe(false)
    expect(hasUsableBrandProfile(profile({ audience: null }))).toBe(false)
    expect(hasUsableBrandProfile(profile({ value_proposition: null }))).toBe(false)
    expect(hasUsableBrandProfile(profile({ offerings: null }))).toBe(false)
  })

  it('los espacios en blanco no cuentan como lleno', () => {
    expect(hasUsableBrandProfile(profile({ tone: '   ' }))).toBe(false)
    expect(hasUsableBrandProfile(profile({ offerings: '\n\t ' }))).toBe(false)
  })

  it('no exige persona, qué evitar, hashtags ni copys de ejemplo', () => {
    expect(hasUsableBrandProfile(profile({ person: null, avoid: null, base_hashtags: null, sample_copies: null }))).toBe(true)
  })
})

describe('validateBrandPatch', () => {
  it('acepta un parche vacío y campos dentro de sus topes', () => {
    expect(validateBrandPatch({})).toEqual({ ok: true })
    expect(validateBrandPatch({ tone: 'a'.repeat(BRAND_TEXT_LIMITS.tone) })).toEqual({ ok: true })
    expect(validateBrandPatch({ audience: 'a'.repeat(BRAND_TEXT_LIMITS.audience) })).toEqual({ ok: true })
    expect(validateBrandPatch({ value_proposition: 'a'.repeat(BRAND_TEXT_LIMITS.value_proposition) })).toEqual({ ok: true })
    expect(validateBrandPatch({ offerings: 'a'.repeat(BRAND_TEXT_LIMITS.offerings) })).toEqual({ ok: true })
    expect(validateBrandPatch({ avoid: 'a'.repeat(BRAND_TEXT_LIMITS.avoid) })).toEqual({ ok: true })
  })

  it('acepta null para limpiar cualquier campo', () => {
    expect(validateBrandPatch({ tone: null, avoid: null, base_hashtags: null, sample_copies: null, person: null })).toEqual({ ok: true })
  })

  it('rechaza textos que pasan su tope, con mensaje en español', () => {
    const r = validateBrandPatch({ tone: 'a'.repeat(BRAND_TEXT_LIMITS.tone + 1) })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toMatch(/tono/i)
    expect(validateBrandPatch({ audience: 'a'.repeat(BRAND_TEXT_LIMITS.audience + 1) }).ok).toBe(false)
    expect(validateBrandPatch({ value_proposition: 'a'.repeat(BRAND_TEXT_LIMITS.value_proposition + 1) }).ok).toBe(false)
    expect(validateBrandPatch({ offerings: 'a'.repeat(BRAND_TEXT_LIMITS.offerings + 1) }).ok).toBe(false)
    expect(validateBrandPatch({ avoid: 'a'.repeat(BRAND_TEXT_LIMITS.avoid + 1) }).ok).toBe(false)
  })

  it('rechaza textos que no son string (entrada no confiable)', () => {
    expect(validateBrandPatch({ tone: 5 as never }).ok).toBe(false)
    expect(validateBrandPatch({ offerings: ['x'] as never }).ok).toBe(false)
  })

  it('persona gramatical: solo voseo, tuteo o usted', () => {
    for (const p of BRAND_PERSONS) expect(validateBrandPatch({ person: p })).toEqual({ ok: true })
    expect(validateBrandPatch({ person: 'vos' as never }).ok).toBe(false)
    expect(validateBrandPatch({ person: '' as never }).ok).toBe(false)
    expect(validateBrandPatch({ person: 3 as never }).ok).toBe(false)
  })

  it('hashtags: hasta 15, de 40 caracteres cada uno', () => {
    const many = Array.from({ length: BRAND_MAX_HASHTAGS }, (_, i) => `#tag${i}`)
    expect(validateBrandPatch({ base_hashtags: [] })).toEqual({ ok: true })
    expect(validateBrandPatch({ base_hashtags: many })).toEqual({ ok: true })
    expect(validateBrandPatch({ base_hashtags: [...many, '#uno_mas'] }).ok).toBe(false)
    expect(validateBrandPatch({ base_hashtags: ['#' + 'a'.repeat(BRAND_TEXT_LIMITS.base_hashtag) ] }).ok).toBe(false)
    expect(validateBrandPatch({ base_hashtags: ['#' + 'a'.repeat(BRAND_TEXT_LIMITS.base_hashtag - 1)] })).toEqual({ ok: true })
  })

  it('hashtags: rechaza lo que no es array y los elementos que no son string', () => {
    expect(validateBrandPatch({ base_hashtags: '#uno' as never }).ok).toBe(false)
    expect(validateBrandPatch({ base_hashtags: [1] as never }).ok).toBe(false)
    expect(validateBrandPatch({ base_hashtags: [null] as never }).ok).toBe(false)
  })

  it('copys de ejemplo: hasta 5, de 1000 caracteres cada uno', () => {
    const five = Array.from({ length: BRAND_MAX_SAMPLE_COPIES }, (_, i) => `Copy ${i}`)
    expect(validateBrandPatch({ sample_copies: [] })).toEqual({ ok: true })
    expect(validateBrandPatch({ sample_copies: five })).toEqual({ ok: true })
    expect(validateBrandPatch({ sample_copies: [...five, 'Uno más'] }).ok).toBe(false)
    expect(validateBrandPatch({ sample_copies: ['a'.repeat(BRAND_TEXT_LIMITS.sample_copy + 1)] }).ok).toBe(false)
    expect(validateBrandPatch({ sample_copies: ['a'.repeat(BRAND_TEXT_LIMITS.sample_copy)] })).toEqual({ ok: true })
  })

  it('copys de ejemplo: rechaza lo que no es array y los elementos que no son string', () => {
    expect(validateBrandPatch({ sample_copies: 'Copy' as never }).ok).toBe(false)
    expect(validateBrandPatch({ sample_copies: [{ text: 'Copy' }] as never }).ok).toBe(false)
  })

  it('los mensajes de error van en español', () => {
    const errors = [
      validateBrandPatch({ tone: 'a'.repeat(501) }),
      validateBrandPatch({ person: 'vos' as never }),
      validateBrandPatch({ base_hashtags: Array.from({ length: 16 }, () => '#x') }),
      validateBrandPatch({ sample_copies: Array.from({ length: 6 }, () => 'x') }),
    ]
    for (const e of errors) {
      expect(e.ok).toBe(false)
      if (e.ok === false) {
        expect(e.error.length).toBeGreaterThan(0)
        expect(e.error).toMatch(/[áéíóúñ¿¡]|demasiado|Máximo|inválid/i)
      }
    }
  })
})
