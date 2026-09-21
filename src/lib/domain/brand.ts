import type { BrandPerson, ClientBrandProfile } from '@/types/db'

/**
 * Perfil de marca del cliente (bloque 3): el contexto con el que la IA escribe. Dominio puro —
 * ni base ni red— para que la UI, la server action y el handler compartan exactamente las mismas
 * reglas.
 */

/**
 * Topes de longitud (caracteres, tras recortar espacios) del perfil. Los usa la UI como `maxLength`,
 * la server action para validar y los checks `client_brand_profiles_*_chk` de la migración 0131.
 * Si se cambia un tope, se cambia en los tres lados.
 *
 * `base_hashtag` y `sample_copy` son topes POR ELEMENTO de los dos arrays: la base no los valida
 * (un check no recorre un array sin subconsulta), así que aquí es el único lugar donde existen.
 */
export const BRAND_TEXT_LIMITS = {
  tone: 500,
  audience: 800,
  value_proposition: 800,
  offerings: 1500,
  avoid: 1000,
  base_hashtag: 40,
  sample_copy: 1000,
} as const

/** Cuántos elementos acepta cada array (mismo tope que los checks de 0131). */
export const BRAND_MAX_HASHTAGS = 15
export const BRAND_MAX_SAMPLE_COPIES = 5

/**
 * Persona gramatical. En El Salvador el voseo es lo normal y un copy en tuteo se nota de inmediato,
 * así que se elige a mano en vez de dejarlo al modelo.
 */
export const BRAND_PERSONS: readonly BrandPerson[] = ['voseo', 'tuteo', 'usted'] as const

export const BRAND_PERSON_LABELS: Record<BrandPerson, string> = {
  voseo: 'Voseo (vos)',
  tuteo: 'Tuteo (tú)',
  usted: 'Usted',
}

/** Campos sin los que la generación no arranca: son los que evitan el texto genérico. */
export const BRAND_REQUIRED_FIELDS = ['tone', 'audience', 'value_proposition', 'offerings'] as const

export type BrandPatch = Partial<Pick<ClientBrandProfile,
  'tone' | 'person' | 'audience' | 'value_proposition' | 'offerings' | 'avoid' | 'base_hashtags' | 'sample_copies'>>

/**
 * La compuerta del bloque: sin perfil usable no se genera. "Usable" es tener llenos los cuatro campos
 * que dan contexto real; `person`, `avoid`, los hashtags y los copys de ejemplo mejoran el resultado
 * pero no son obligatorios. Los espacios en blanco no cuentan como lleno.
 */
export function hasUsableBrandProfile(profile: ClientBrandProfile | null | undefined): boolean {
  if (!profile) return false
  return BRAND_REQUIRED_FIELDS.every((k) => {
    const v = profile[k]
    return typeof v === 'string' && v.trim().length > 0
  })
}

/** Campos de texto libre: tope y etiqueta para el mensaje de error (las del formulario). */
const TEXT_FIELDS = [
  { key: 'tone', max: BRAND_TEXT_LIMITS.tone, label: 'El tono' },
  { key: 'audience', max: BRAND_TEXT_LIMITS.audience, label: 'El público' },
  { key: 'value_proposition', max: BRAND_TEXT_LIMITS.value_proposition, label: 'La propuesta de valor' },
  { key: 'offerings', max: BRAND_TEXT_LIMITS.offerings, label: 'La oferta' },
  { key: 'avoid', max: BRAND_TEXT_LIMITS.avoid, label: 'Qué evitar' },
] as const

const INVALID_DATA = 'Datos inválidos.'

/**
 * Valida un parche del perfil. `undefined` = campo intacto, `null` = limpiar. Todo lo demás viene del
 * navegador y no se confía: se comprueba el tipo de cada valor y, en los arrays, el de cada elemento.
 * Solo valida; recortar y normalizar es cosa de la acción (como `validateItemPatch` en matrix.ts).
 */
export function validateBrandPatch(patch: BrandPatch): { ok: true } | { ok: false; error: string } {
  for (const f of TEXT_FIELDS) {
    const v = patch[f.key]
    if (v === undefined || v === null) continue
    if (typeof v !== 'string') return { ok: false, error: INVALID_DATA }
    if (v.trim().length > f.max) {
      return { ok: false, error: `${f.label} es demasiado largo (máximo ${f.max} caracteres).` }
    }
  }

  if (patch.person !== undefined && patch.person !== null) {
    if (typeof patch.person !== 'string' || !BRAND_PERSONS.includes(patch.person)) {
      return { ok: false, error: 'Persona gramatical inválida.' }
    }
  }

  if (patch.base_hashtags !== undefined && patch.base_hashtags !== null) {
    const list = patch.base_hashtags
    if (!Array.isArray(list)) return { ok: false, error: INVALID_DATA }
    if (list.length > BRAND_MAX_HASHTAGS) {
      return { ok: false, error: `Máximo ${BRAND_MAX_HASHTAGS} hashtags base.` }
    }
    for (const h of list) {
      if (typeof h !== 'string') return { ok: false, error: INVALID_DATA }
      if (h.trim().length > BRAND_TEXT_LIMITS.base_hashtag) {
        return { ok: false, error: `Cada hashtag admite ${BRAND_TEXT_LIMITS.base_hashtag} caracteres como máximo.` }
      }
    }
  }

  if (patch.sample_copies !== undefined && patch.sample_copies !== null) {
    const list = patch.sample_copies
    if (!Array.isArray(list)) return { ok: false, error: INVALID_DATA }
    if (list.length > BRAND_MAX_SAMPLE_COPIES) {
      return { ok: false, error: `Máximo ${BRAND_MAX_SAMPLE_COPIES} copys de ejemplo.` }
    }
    for (const c of list) {
      if (typeof c !== 'string') return { ok: false, error: INVALID_DATA }
      if (c.trim().length > BRAND_TEXT_LIMITS.sample_copy) {
        return { ok: false, error: `Cada copy de ejemplo admite ${BRAND_TEXT_LIMITS.sample_copy} caracteres como máximo.` }
      }
    }
  }

  return { ok: true }
}
