/**
 * Lógica pura de selección de recordatorios de factura por vencer.
 * Separada del acceso a datos para poder testearla de verdad.
 */

export interface ReminderCandidate {
  invoiceId: string
  clientId: string
  phoneE164: string | null
  /** YYYY-MM-DD */
  dueDate: string
}

/**
 * Un recordatorio por NÚMERO por corrida, el de vencimiento más próximo.
 *
 * Sin este throttle, un cliente con renovación + extra —o un número vinculado a
 * varias marcas (migración 0122)— recibiría varios mensajes la misma mañana.
 * Los descartados quedan sin marcar en la DB, así que salen en corridas
 * siguientes mientras sigan dentro de la ventana.
 *
 * El desempate por `invoiceId` mantiene la selección estable (determinista)
 * cuando dos facturas vencen el mismo día.
 */
export function selectRemindersToSend(candidates: ReminderCandidate[]): ReminderCandidate[] {
  const byPhone = new Map<string, ReminderCandidate>()

  const ordered = [...candidates].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.invoiceId.localeCompare(b.invoiceId),
  )

  for (const cand of ordered) {
    if (!cand.phoneE164) continue
    if (!byPhone.has(cand.phoneE164)) byPhone.set(cand.phoneE164, cand)
  }

  return Array.from(byPhone.values())
}
