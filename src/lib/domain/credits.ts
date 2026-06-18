/**
 * Helpers para créditos del cliente sin caducidad.
 *
 * Modelo:
 *   - Una factura con `extras_metadata` poblado se considera "paquete extra".
 *   - Al pagar la factura, `grantCreditsFromInvoice` materializa una fila en
 *     `client_credits` con `qty_remaining = qty`.
 *   - Los créditos se consumen vía `consumeCredit` (FIFO por `created_at`).
 *   - Al anular un consumo (cambio anulado, requerimiento voided), se llama
 *     `refundCredit` para devolver +1 al crédito original.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ClientCredit,
  ContentType,
  CreditKind,
  InvoiceExtrasMetadata,
} from '@/types/db'
import { CONTENT_TYPE_TO_CREDIT_KIND, CREDIT_KIND_TO_CONTENT_TYPE } from '@/types/db'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Materializa los créditos correspondientes a una factura pagada.
 * Idempotente — el unique index `(source_invoice_id, kind)` evita duplicados.
 * Solo opera si `invoice.extras_metadata` está poblado.
 */
export async function grantCreditsFromInvoice(
  admin: SupabaseClient,
  invoiceId: string,
): Promise<{ ok: true; credits: ClientCredit[] } | { ok: false; error: string }> {
  const { data: inv } = await admin
    .from('invoices')
    .select('id, client_id, total_a_pagar, extras_metadata')
    .eq('id', invoiceId)
    .single()
  if (!inv) return { ok: false, error: 'Factura no encontrada' }

  const meta = inv.extras_metadata as InvoiceExtrasMetadata | null
  if (!meta || !meta.kind || meta.qty == null || meta.qty <= 0) {
    return { ok: true, credits: [] } // No es un paquete extra; nada que materializar
  }

  let kind: CreditKind | null = null
  if (meta.kind === 'cambios') {
    kind = 'cambios'
  } else if (meta.kind === 'content' && meta.content_type) {
    kind = CONTENT_TYPE_TO_CREDIT_KIND[meta.content_type] ?? null
  }
  if (!kind) {
    return { ok: false, error: `Tipo de paquete no soportado: ${meta.kind}/${meta.content_type ?? '-'}` }
  }

  const unit = meta.qty > 0 ? Number(inv.total_a_pagar ?? 0) / meta.qty : 0

  const { data: inserted, error } = await admin
    .from('client_credits')
    .upsert(
      {
        client_id: inv.client_id as string,
        kind,
        qty_initial: meta.qty,
        qty_remaining: meta.qty,
        unit_price_usd: Math.round(unit * 100) / 100,
        source_invoice_id: invoiceId,
      },
      { onConflict: 'source_invoice_id,kind', ignoreDuplicates: true },
    )
    .select('*')
  if (error) return { ok: false, error: error.message }

  return { ok: true, credits: (inserted ?? []) as ClientCredit[] }
}

/**
 * Consume 1 unidad de un crédito disponible para el cliente y kind dados.
 * Estrategia: FIFO por `created_at`. Atómico (decremento condicional).
 * Devuelve el `id` del crédito usado o null si no hay disponibles.
 */
export async function consumeCredit(
  admin: SupabaseClient,
  args: { clientId: string; kind: CreditKind },
): Promise<string | null> {
  // Buscar el crédito más antiguo con saldo
  const { data: candidate } = await admin
    .from('client_credits')
    .select('id, qty_remaining')
    .eq('client_id', args.clientId)
    .eq('kind', args.kind)
    .gt('qty_remaining', 0)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!candidate?.id) return null

  // Decrementar (con guard para evitar carrera)
  const { data: updated, error } = await admin
    .from('client_credits')
    .update({ qty_remaining: (candidate.qty_remaining as number) - 1 })
    .eq('id', candidate.id)
    .eq('qty_remaining', candidate.qty_remaining as number)
    .select('id')
    .maybeSingle()
  if (error || !updated?.id) return null
  return updated.id as string
}

/** Devuelve +1 a un crédito específico (anulación). */
export async function refundCredit(
  admin: SupabaseClient,
  creditId: string,
): Promise<boolean> {
  const { data: c } = await admin
    .from('client_credits')
    .select('qty_remaining, qty_initial')
    .eq('id', creditId)
    .maybeSingle()
  if (!c) return false
  const next = Math.min((c.qty_remaining as number) + 1, c.qty_initial as number)
  const { error } = await admin
    .from('client_credits')
    .update({ qty_remaining: next })
    .eq('id', creditId)
  return !error
}

/**
 * Suma de créditos disponibles por content_type para un cliente.
 * Útil al validar `canRegister` de un nuevo requerimiento.
 */
export async function getAvailableContentCredits(
  client: SupabaseClient,
  clientId: string,
): Promise<Partial<Record<ContentType, number>>> {
  const { data } = await client
    .from('client_credits')
    .select('kind, qty_remaining')
    .eq('client_id', clientId)
    .gt('qty_remaining', 0)
  const result: Partial<Record<ContentType, number>> = {}
  for (const row of (data ?? []) as Array<{ kind: CreditKind; qty_remaining: number }>) {
    const ct = CREDIT_KIND_TO_CONTENT_TYPE[row.kind]
    if (!ct) continue
    result[ct] = (result[ct] ?? 0) + row.qty_remaining
  }
  return result
}

/** Cuántos cambios extras (sin caducidad) tiene el cliente. */
export async function getAvailableCambiosCredits(
  client: SupabaseClient,
  clientId: string,
): Promise<number> {
  const { data } = await client
    .from('client_credits')
    .select('qty_remaining')
    .eq('client_id', clientId)
    .eq('kind', 'cambios')
    .gt('qty_remaining', 0)
  return (data ?? []).reduce((sum, r) => sum + (r.qty_remaining as number), 0)
}

export interface CambiosBalance {
  included: number
  used: number
  remaining_cycle: number
  extra_credits: number
  total_available: number
  pending: number
}

/** Aritmética pura del pool de cambios. Sin DB — testeable directo. */
export function computeCambiosBalance(input: {
  included: number
  used: number
  extraCredits: number
  pending: number
}): CambiosBalance {
  const remaining_cycle = Math.max(0, input.included - input.used)
  return {
    included: input.included,
    used: input.used,
    remaining_cycle,
    extra_credits: input.extraCredits,
    total_available: remaining_cycle + input.extraCredits,
    pending: input.pending,
  }
}

/**
 * Cuenta cambios APROBADOS (no-crédito, no anulados) en todo el ciclo.
 * Misma cuenta que consumeCambioSlot — fuente única de verdad del cupo usado.
 */
export async function countApprovedCambiosInCycle(
  admin: SupabaseClient,
  billingCycleId: string,
): Promise<number> {
  const { data: cycleReqs } = await admin
    .from('requirements')
    .select('id')
    .eq('billing_cycle_id', billingCycleId)
  const reqIds = (cycleReqs ?? []).map((r: { id: string }) => r.id)
  if (reqIds.length === 0) return 0
  const { count } = await admin
    .from('requirement_cambio_logs')
    .select('id', { count: 'exact', head: true })
    .in('requirement_id', reqIds)
    .eq('status', 'approved')
    .neq('voided', true)
    .is('paid_from_credit_id', null)
  return count ?? 0
}

/** Cuenta cambios PENDIENTES de aprobación en el ciclo (los ya pedidos, aún sin aplicar). */
export async function countPendingCambiosInCycle(
  admin: SupabaseClient,
  billingCycleId: string,
): Promise<number> {
  const { data: cycleReqs } = await admin
    .from('requirements')
    .select('id')
    .eq('billing_cycle_id', billingCycleId)
  const reqIds = (cycleReqs ?? []).map((r: { id: string }) => r.id)
  if (reqIds.length === 0) return 0
  const { count } = await admin
    .from('requirement_cambio_logs')
    .select('id', { count: 'exact', head: true })
    .in('requirement_id', reqIds)
    .eq('status', 'pending')
    .neq('voided', true)
  return count ?? 0
}

/**
 * Saldo del pool de cambios del mes para un cliente. Crea su propio admin client
 * (igual que checkRequestEligibilityForClient). Devuelve `null` si no hay ciclo activo.
 */
export async function getCambiosBalance(clientId: string): Promise<CambiosBalance | null> {
  const admin = createAdminClient()
  const { data: cycle } = await admin
    .from('billing_cycles')
    .select('id')
    .eq('client_id', clientId)
    .eq('status', 'current')
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!cycle?.id) return null

  const { data: clientRow } = await admin
    .from('clients')
    .select('plan:plans(cambios_included)')
    .eq('id', clientId)
    .maybeSingle()
  const included: number =
    (clientRow?.plan as { cambios_included: number } | null)?.cambios_included ?? 0

  const [used, pending, extraCredits] = await Promise.all([
    countApprovedCambiosInCycle(admin, cycle.id as string),
    countPendingCambiosInCycle(admin, cycle.id as string),
    getAvailableCambiosCredits(admin, clientId),
  ])

  return computeCambiosBalance({ included, used, extraCredits, pending })
}
