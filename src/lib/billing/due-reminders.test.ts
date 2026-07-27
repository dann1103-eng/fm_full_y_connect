import { describe, it, expect } from 'vitest'
import { selectRemindersToSend, type ReminderCandidate } from './due-reminders'

const c = (o: Partial<ReminderCandidate>): ReminderCandidate => ({
  invoiceId: 'i1',
  clientId: 'c1',
  phoneE164: '+50370000000',
  dueDate: '2026-08-01',
  ...o,
})

describe('selectRemindersToSend', () => {
  it('envía una sola factura por teléfono: la de vencimiento más próximo', () => {
    const out = selectRemindersToSend([
      c({ invoiceId: 'tarde', dueDate: '2026-08-03' }),
      c({ invoiceId: 'pronto', dueDate: '2026-08-01' }),
    ])
    expect(out.map((r) => r.invoiceId)).toEqual(['pronto'])
  })

  it('no mezcla teléfonos distintos: cada número recibe el suyo', () => {
    const out = selectRemindersToSend([
      c({ invoiceId: 'a', phoneE164: '+50370000001' }),
      c({ invoiceId: 'b', phoneE164: '+50370000002' }),
    ])
    expect(out.map((r) => r.invoiceId).sort()).toEqual(['a', 'b'])
  })

  it('agrupa por teléfono aunque sean marcas distintas (multi-marca)', () => {
    // Mismo número vinculado a dos clientes: un solo recordatorio ese día.
    const out = selectRemindersToSend([
      c({ invoiceId: 'marcaA', clientId: 'cA', dueDate: '2026-08-02' }),
      c({ invoiceId: 'marcaB', clientId: 'cB', dueDate: '2026-08-01' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.invoiceId).toBe('marcaB')
  })

  it('descarta candidatos sin teléfono', () => {
    expect(selectRemindersToSend([c({ phoneE164: null })])).toEqual([])
  })

  it('descarta los sin teléfono sin perder los válidos del mismo lote', () => {
    const out = selectRemindersToSend([
      c({ invoiceId: 'sin', phoneE164: null }),
      c({ invoiceId: 'con', phoneE164: '+50370000009' }),
    ])
    expect(out.map((r) => r.invoiceId)).toEqual(['con'])
  })

  it('desempata de forma estable cuando dos facturas vencen el mismo día', () => {
    const out = selectRemindersToSend([
      c({ invoiceId: 'b', dueDate: '2026-08-01' }),
      c({ invoiceId: 'a', dueDate: '2026-08-01' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.invoiceId).toBe('a')
  })

  it('no muta el arreglo recibido', () => {
    const input = [
      c({ invoiceId: 'b', dueDate: '2026-08-03' }),
      c({ invoiceId: 'a', dueDate: '2026-08-01' }),
    ]
    selectRemindersToSend(input)
    expect(input.map((r) => r.invoiceId)).toEqual(['b', 'a'])
  })

  it('devuelve vacío si no hay candidatos', () => {
    expect(selectRemindersToSend([])).toEqual([])
  })
})
