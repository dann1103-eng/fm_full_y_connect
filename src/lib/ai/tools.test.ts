import { describe, it, expect } from 'vitest'
import { TOOL_DEFS, TOOL_FNS, filterEnabled } from './tools'

/**
 * Invariantes del registro de tools. Si una tool aparece en TOOL_DEFS pero no
 * en TOOL_FNS, el bot se la ofrece a Claude y al invocarla falla en runtime con
 * "tool_not_implemented" — un error que solo se ve en producción, hablando con
 * un cliente real.
 */
describe('registro de tools', () => {
  it('toda tool declarada tiene implementación', () => {
    const declaredSinFn = Object.keys(TOOL_DEFS).filter((name) => !TOOL_FNS[name])
    expect(declaredSinFn).toEqual([])
  })

  it('toda implementación está declarada', () => {
    const fnSinDef = Object.keys(TOOL_FNS).filter((name) => !TOOL_DEFS[name])
    expect(fnSinDef).toEqual([])
  })

  it('el name de cada def coincide con su clave', () => {
    for (const [key, def] of Object.entries(TOOL_DEFS)) {
      expect(def.name).toBe(key)
    }
  })

  it('filterEnabled solo devuelve las tools habilitadas', () => {
    const out = filterEnabled(['send_invoice_document', 'get_billing_status'])
    expect(out.map((t) => t.name).sort()).toEqual(['get_billing_status', 'send_invoice_document'])
  })

  it('filterEnabled ignora nombres desconocidos en la config', () => {
    // enabled_tools se edita a mano en /admin/whatsapp: un typo no debe romper el bot.
    const out = filterEnabled(['get_billing_status', 'tool_que_no_existe'])
    expect(out.map((t) => t.name)).toEqual(['get_billing_status'])
  })

  it('send_invoice_document no exige argumentos (puede enviar la más reciente)', () => {
    const def = TOOL_DEFS['send_invoice_document']!
    expect(def.input_schema.required ?? []).toEqual([])
  })
})
