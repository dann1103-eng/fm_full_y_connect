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
import { CONTENT_TYPE_TO_CREDIT_KIND, CREDIT_KIND_TO_CONTENT_TYPE, POOL_CREDIT_KIND } from '@/types/db'
import { TIPPABLE_CONTENT_TYPES } from '@/lib/domain/plans'
import { createAdminClient } from '@/lib/supabase/admin'

/** Qué tipo de crédito materializa un paquete extra. null = metadata no soportada. */
export function creditKindFromExtras(meta: InvoiceExtrasMetadata): CreditKind | null {
  if (meta.kind === 'cambios') return 'cambios'
  if (meta.kind === 'content_pool') return POOL_CREDIT_KIND
  if (meta.kind === 'content' && meta.content_type) {
    return CONTENT_TYPE_TO_CREDIT_KIND[meta.content_type] ?? null
  }
  return null
}

/**
 * Tipos de crédito que pueden cubrir un contenido, EN ORDEN DE USO: primero el crédito específico
 * del tipo (se compró a propósito para él) y luego el paquete on-demand, que cubre cualquier tipo
 * tippable. Historias, producciones y reuniones no se cubren con créditos de contenido.
 */
export function creditKindsForContent(contentType: ContentType): CreditKind[] {
  const kinds: CreditKind[] = []
  const specific = CONTENT_TYPE_TO_CREDIT_KIND[contentType]
  if (specific) kinds.push(specific)
  if (TIPPABLE_CONTENT_TYPES.includes(contentType)) kinds.push(POOL_CREDIT_KIND)
  return kinds
}

export interface RegistrationInput {
  /** Consumo del requerimiento nuevo por tipo (base + historia si aplica, o los overrides del admin). */
  breakdown: Partial<Record<ContentType, number>>
  /** Consumo ya registrado en el ciclo, por tipo. */
  totals: Partial<Record<ContentType, number>>
  /** Límites del plan del ciclo, por tipo (sin créditos). */
  limits: Partial<Record<ContentType, number>>
  /** Créditos específicos por tipo (sin el paquete). */
  typeCredits: Partial<Record<ContentType, number>>
  /** Saldo del paquete on-demand. */
  poolCredits: number
  /** Plan de cupo compartido entre tipos tippables, o null en un plan normal. */
  sharedPool: { used: number; limit: number } | null
  /** Tipo principal del requerimiento (el que se paga con el crédito). */
  primaryType: ContentType
}

export interface RegistrationVerdict {
  /** Cabe sin forzar: con el plan, los créditos por tipo y/o el paquete on-demand. */
  allowed: boolean
  /** Para caber hace falta descontar del paquete on-demand. */
  usesPackage: boolean
  /** Unidades que cubriría el paquete (0 si no lo usa). */
  packageUnits: number
  /** El contenido principal excede el cupo del plan: debe pagarse con un crédito si hay. */
  exceedsPlan: boolean
}

/**
 * ¿Se puede registrar este requerimiento y con qué se paga lo que excede el cupo del mes?
 * Función pura: la usa el formulario de requerimientos.
 *
 * Con `poolCredits = 0` reproduce exactamente la regla anterior (plan + créditos por tipo, o el
 * cupo compartido). El paquete on-demand solo cubre excedentes de tipos tippables: una historia
 * u otro tipo fuera de cupo sigue sin poder registrarse sin forzar.
 */
export function evaluateRegistration(input: RegistrationInput): RegistrationVerdict {
  const pool = Math.max(0, input.poolCredits)

  if (input.sharedPool) {
    const sum = TIPPABLE_CONTENT_TYPES.reduce((s, t) => s + (input.breakdown[t] ?? 0), 0)
    const overflow = Math.max(0, input.sharedPool.used + sum - input.sharedPool.limit)
    const allowed = overflow <= pool
    return {
      allowed,
      usesPackage: allowed && overflow > 0,
      packageUnits: allowed ? overflow : 0,
      exceedsPlan: overflow > 0,
    }
  }

  let tippableOverflow = 0
  let untippableOverflow = false
  for (const [type, qty] of Object.entries(input.breakdown) as [ContentType, number | undefined][]) {
    if (!qty || qty <= 0) continue
    const effective = (input.limits[type] ?? 0) + (input.typeCredits[type] ?? 0)
    const over = Math.max(0, (input.totals[type] ?? 0) + qty - effective)
    if (over === 0) continue
    if (TIPPABLE_CONTENT_TYPES.includes(type)) tippableOverflow += over
    else untippableOverflow = true
  }
  const allowed = !untippableOverflow && tippableOverflow <= pool
  return {
    allowed,
    usesPackage: allowed && tippableOverflow > 0,
    packageUnits: allowed ? tippableOverflow : 0,
    exceedsPlan: (input.totals[input.primaryType] ?? 0) + 1 > (input.limits[input.primaryType] ?? 0),
  }
}

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

  const kind = creditKindFromExtras(meta)
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

/**
 * Descuenta 1 crédito para pagar un contenido: primero uno específico del tipo y, si no hay,
 * del paquete on-demand. Devuelve el id del crédito usado o null si no hay ninguno.
 */
export async function consumeContentCredit(
  admin: SupabaseClient,
  args: { clientId: string; contentType: ContentType },
): Promise<string | null> {
  for (const kind of creditKindsForContent(args.contentType)) {
    const creditId = await consumeCredit(admin, { clientId: args.clientId, kind })
    if (creditId) return creditId
  }
  return null
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

/** Saldo del paquete on-demand del cliente (suma de sus créditos `content_pool` con saldo). */
export async function getAvailablePoolCredits(
  client: SupabaseClient,
  clientId: string,
): Promise<number> {
  const { data } = await client
    .from('client_credits')
    .select('qty_remaining')
    .eq('client_id', clientId)
    .eq('kind', POOL_CREDIT_KIND)
    .gt('qty_remaining', 0)
  return (data ?? []).reduce((sum, r) => sum + (r.qty_remaining as number), 0)
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
