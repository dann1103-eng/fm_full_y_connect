import { describe, it, expect } from 'vitest'
import { BRIEF_WORKING_RANGES, buildBriefPrompt, scriptRange, type BriefPromptInput } from './prompts'
import { MATRIX_CHILD_PARAMS } from './model'
import { MATRIX_CONTENT_TYPES, MATRIX_TEXT_LIMITS } from '@/lib/domain/matrix'
import type { ContentType } from '@/types/db'

/**
 * Cuenta conservadora de caracteres por token: el español con tildes y el escapado del JSON de la tool
 * rinden menos que el inglés (~4); con 3 la estimación queda del lado seguro.
 */
const CHARS_PER_TOKEN = 3
/** Claves, comillas y escapes del `tool_use`, más `objective` y `needs_production`. */
const JSON_OVERHEAD_TOKENS = 100
/** Parte de `max_tokens` que puede ocupar el peor caso: el resto es margen para que el modelo se pase. */
const MAX_SHARE = 0.75

function item(content_type: ContentType): BriefPromptInput['item'] {
  return {
    content_type, title: 'Pieza de prueba', topic: null, objective: null, deadline: '2026-10-15',
    needs_production: false, copy: null, script: null, visual_style: null, hashtags: null, cta: null,
  }
}

describe('presupuesto del brief del hijo', () => {
  it.each(MATRIX_CONTENT_TYPES)('el peor caso de los rangos cabe con holgura en max_tokens (%s)', (type) => {
    const R = BRIEF_WORKING_RANGES
    const worstChars = R.copy.max + scriptRange(type).max + R.visual_style.max + R.hashtags.max + R.cta.max
    const tokens = Math.ceil(worstChars / CHARS_PER_TOKEN) + JSON_OVERHEAD_TOKENS
    expect(tokens).toBeLessThanOrEqual(MATRIX_CHILD_PARAMS.max_tokens * MAX_SHARE)
  })

  it('ningún rango de trabajo pasa del tope duro de su campo', () => {
    const R = BRIEF_WORKING_RANGES
    expect(R.copy.max).toBeLessThanOrEqual(MATRIX_TEXT_LIMITS.copy)
    expect(R.scriptVideo.max).toBeLessThanOrEqual(MATRIX_TEXT_LIMITS.script)
    expect(R.scriptShort.max).toBeLessThanOrEqual(MATRIX_TEXT_LIMITS.script)
    expect(R.visual_style.max).toBeLessThanOrEqual(MATRIX_TEXT_LIMITS.visual_style)
    expect(R.hashtags.max).toBeLessThanOrEqual(MATRIX_TEXT_LIMITS.hashtags)
    expect(R.cta.max).toBeLessThanOrEqual(MATRIX_TEXT_LIMITS.cta)
  })
})

describe('buildBriefPrompt — largo de los campos', () => {
  it('pide el rango de guion de video en un reel y el corto en un estático', () => {
    const { scriptVideo, scriptShort } = BRIEF_WORKING_RANGES
    expect(buildBriefPrompt({ item: item('reel') })).toContain(`- script: ${scriptVideo.min}–${scriptVideo.max} caracteres`)
    expect(buildBriefPrompt({ item: item('estatico') })).toContain(`- script: ${scriptShort.min}–${scriptShort.max} caracteres`)
  })

  it('ofrece rangos de trabajo y deja el tope duro solo como referencia', () => {
    const prompt = buildBriefPrompt({ item: item('video_corto') })
    const { copy } = BRIEF_WORKING_RANGES
    expect(prompt).toContain(`- copy: ${copy.min}–${copy.max} caracteres (el tope duro es ${MATRIX_TEXT_LIMITS.copy})`)
    expect(prompt).not.toContain('Topes de longitud')
  })
})
