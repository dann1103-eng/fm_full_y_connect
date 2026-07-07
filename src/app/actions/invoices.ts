'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildClientSnapshot,
  buildEmitterSnapshot,
  calculateTotals,
  type LineItemInput,
} from '@/lib/domain/invoices'
import { markInvoicePaidCore } from '@/lib/domain/invoice-paid'
import { regenerateInvoiceLinkCore } from '@/lib/domain/invoice-create'
import { nextCycleDates } from '@/lib/domain/cycles'
import { today as todayString } from '@/lib/domain/dates'
import { createInvoicePaymentLink, extractPaymentLinkId } from '@/lib/n1co/payment-links'
import { N1coApiError } from '@/lib/n1co/types'
import type {
  Client,
  CompanySettings,
  DteTipo,
  InvoiceExtrasMetadata,
  InvoicePaymentMethod,
  PaymentProvider,
  Plan,
  BillingCycle,
} from '@/types/db'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' as const }
  const { data: appUser } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'admin') return { error: 'Solo admins pueden gestionar facturas' as const }
  return { userId: user.id }
}

async function loadEmitter() {
  const admin = createAdminClient()
  const { data } = await admin.from('company_settings').select('*').limit(1).maybeSingle()
  return data as CompanySettings | null
}

export interface CreateInvoiceInput {
  clientId: string
  billingCycleId?: string | null
  quoteId?: string | null
  items: LineItemInput[]
  taxRate: number
  discountAmount?: number
  /** Si se omite, se hereda de clients.aplica_renta_retenida (10% si true). */
  retentionRate?: number
  dueDate?: string | null
  notes?: string | null
  biweeklyHalf?: 'first' | 'second' | null
  paymentProvider?: PaymentProvider
  /** Si la factura corresponde a un paquete extra (cambios o contenido). Se materializa como crédito al pagar. */
  extrasMetadata?: InvoiceExtrasMetadata | null
  /** Snapshot de términos y condiciones para esta factura. Si no se pasa, no se incluyen T&C. */
  termsSnapshotJson?: import('@/types/db').TermAndCondition[] | null
}

export async function createInvoice(
  input: CreateInvoiceInput
): Promise<
  | { error: string }
  | { ok: true; invoiceId: string; invoiceNumber: string; n1coPaymentLinkUrl?: string | null }
> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }

  if (!input.clientId) return { error: 'Cliente requerido' as const }
  if (!input.items?.length) return { error: 'La factura debe tener al menos un ítem' as const }

  const admin = createAdminClient()

  const [{ data: clientRow }, emitter] = await Promise.all([
    admin.from('clients').select('*').eq('id', input.clientId).single(),
    loadEmitter(),
  ])
  const client = clientRow as Client | null
  if (!client) return { error: 'Cliente no encontrado' as const }
  if (!emitter) return { error: 'Configuración del emisor no inicializada (company_settings)' as const }

  const retentionRate = input.retentionRate ?? (client.aplica_renta_retenida ? 0.1 : 0)

  const totals = calculateTotals({
    items: input.items,
    tax_rate: input.taxRate,
    discount_amount: input.discountAmount ?? 0,
    retention_rate: retentionRate,
  })

  const { data: numberRow, error: numberErr } = await admin.rpc('next_invoice_number')
  if (numberErr || !numberRow) return { error: 'Error al generar el correlativo' as const }
  const invoiceNumber = numberRow as unknown as string

  // Default a n1co_link cuando hay credencial configurada (uniforme con el cron).
  // Cae a 'manual' si la integración no está disponible (el helper safe lo maneja).
  const hasN1co = !!process.env.N1CO_CHECKOUT_LINK_SECRET
  const paymentProvider: PaymentProvider = input.paymentProvider ?? (hasN1co ? 'n1co_link' : 'manual')

  // Si el caller no pasó due_date pero conocemos el ciclo, usamos su period_start
  // (el cliente paga por adelantado al inicio del período). Si es ad-hoc, sin ciclo,
  // dejamos null para no asumir.
  let resolvedDueDate: string | null = input.dueDate ?? null
  if (!resolvedDueDate && input.billingCycleId) {
    const { data: cycleRow } = await admin
      .from('billing_cycles')
      .select('period_start')
      .eq('id', input.billingCycleId)
      .maybeSingle()
    resolvedDueDate = (cycleRow?.period_start as string | null) ?? null
  }

  const { data: inserted, error: insertErr } = await admin
    .from('invoices')
    .insert({
      invoice_number: invoiceNumber,
      client_id: client.id,
      billing_cycle_id: input.billingCycleId ?? null,
      quote_id: input.quoteId ?? null,
      issue_date: todayString(),
      due_date: resolvedDueDate,
      currency: 'USD',
      subtotal: totals.subtotal,
      discount_amount: totals.discount_amount,
      tax_rate: input.taxRate,
      tax_amount: totals.tax_amount,
      retention_rate: totals.retention_rate,
      retencion_renta_amount: totals.retencion_renta_amount,
      total: totals.total,
      total_a_pagar: totals.total_a_pagar,
      status: 'draft',
      notes: input.notes ?? null,
      client_snapshot_json: buildClientSnapshot(client),
      emitter_snapshot_json: buildEmitterSnapshot(emitter),
      created_by: auth.userId,
      biweekly_half: input.biweeklyHalf ?? null,
      payment_provider: paymentProvider,
      extras_metadata: input.extrasMetadata ?? null,
      terms_snapshot_json: input.termsSnapshotJson ?? null,
    })
    .select('id')
    .single()

  if (insertErr || !inserted?.id) return { error: 'Error al crear la factura' as const }

  const itemsPayload = totals.items.map(it => ({
    invoice_id: inserted.id,
    description: it.description,
    quantity: it.quantity,
    unit_price: it.unit_price,
    line_total: it.line_total,
    sort_order: it.sort_order,
  }))

  const { error: itemsErr } = await admin.from('invoice_items').insert(itemsPayload)
  if (itemsErr) {
    await admin.from('invoices').delete().eq('id', inserted.id)
    return { error: 'Error al guardar los ítems de la factura' as const }
  }

  // Si la factura cubre un scheduled cycle, marcar auto_billed_at para que el
  // cron no genere una segunda factura automática para el mismo período.
  if (input.billingCycleId) {
    const { data: cycleStatus } = await admin
      .from('billing_cycles')
      .select('status')
      .eq('id', input.billingCycleId)
      .maybeSingle()
    if (cycleStatus?.status === 'scheduled') {
      await admin
        .from('billing_cycles')
        .update({ auto_billed_at: new Date().toISOString() })
        .eq('id', input.billingCycleId)
    }
  }

  // Si el método de cobro es n1co_link: generar payment link dinámico ahora.
  let paymentLinkUrl: string | null = null
  if (paymentProvider === 'n1co_link') {
    const planRow = client.current_plan_id
      ? (await admin.from('plans').select('id, name').eq('id', client.current_plan_id).maybeSingle()).data
      : null
    const link = await createPaymentLinkSafe({
      invoiceId: inserted.id as string,
      invoiceNumber,
      amount: totals.total_a_pagar,
      currency: 'USD',
      billingCycleId: input.billingCycleId ?? null,
      clientId: client.id,
      clientName: client.name,
      plan: planRow as { id: string; name: string } | null,
      locationCode: emitter.n1co_location_code ?? undefined,
      dueDate: resolvedDueDate,
    })
    if (link) {
      paymentLinkUrl = link.paymentLinkUrl
      await admin
        .from('invoices')
        .update({
          n1co_payment_link_url: link.paymentLinkUrl,
          n1co_payment_link_id: extractPaymentLinkId(link.paymentLinkUrl) ?? String(link.orderId),
          n1co_order_reference: inserted.id as string,
        })
        .eq('id', inserted.id)
    } else {
      // Si falló la creación del link, dejamos el provider en manual y notificamos por revalidate
      await admin
        .from('invoices')
        .update({ payment_provider: 'manual' as const })
        .eq('id', inserted.id)
    }
  }

  revalidatePath('/billing')
  revalidatePath('/billing/invoices')
  revalidatePath(`/billing/invoices/${inserted.id}`)
  return {
    ok: true as const,
    invoiceId: inserted.id,
    invoiceNumber,
    n1coPaymentLinkUrl: paymentLinkUrl,
  }
}

interface SafeLinkArgs {
  invoiceId: string
  invoiceNumber: string
  /** Monto a cobrar (total_a_pagar, no total del DTE). */
  amount: number
  currency: string
  billingCycleId: string | null
  clientId: string
  clientName: string
  plan: { id: string; name: string } | null
  locationCode?: string
  /** Fecha de vencimiento (YYYY-MM-DD). El link expira al final de ese día. */
  dueDate?: string | null
}

async function createPaymentLinkSafe(args: SafeLinkArgs) {
  try {
    const link = await createInvoicePaymentLink({
      invoice: {
        id: args.invoiceId,
        invoice_number: args.invoiceNumber,
        currency: args.currency,
        billing_cycle_id: args.billingCycleId,
      },
      amount: args.amount,
      client: { id: args.clientId, name: args.clientName },
      plan: args.plan,
      locationCode: args.locationCode,
      dueDate: args.dueDate,
    })
    return link
  } catch (err) {
    if (err instanceof N1coApiError) {
      console.error('[n1co] error creando payment link', err.status, err.body)
    } else {
      console.error('[n1co] error creando payment link', err)
    }
    return null
  }
}

export async function issueInvoice(id: string): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()
  const { error } = await admin
    .from('invoices')
    .update({ status: 'issued' })
    .eq('id', id)
    .eq('status', 'draft')
  if (error) return { error: 'Error al emitir la factura' as const }
  revalidatePath('/billing/invoices')
  revalidatePath(`/billing/invoices/${id}`)
  return { ok: true as const }
}

export async function markInvoicePaid(args: {
  id: string
  paymentMethod: InvoicePaymentMethod
  paymentDate?: string
  paymentReference?: string | null
}): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()

  const result = await markInvoicePaidCore(admin, {
    invoiceId: args.id,
    paymentMethod: args.paymentMethod,
    paymentDate: args.paymentDate,
    paymentReference: args.paymentReference,
  })
  if (!result.ok) return { error: result.error ?? 'Error al marcar la factura como pagada' }

  revalidatePath('/billing')
  revalidatePath('/billing/invoices')
  revalidatePath(`/billing/invoices/${args.id}`)
  if (result.clientId) revalidatePath(`/clients/${result.clientId}`)
  if (result.cycleId) revalidatePath('/renewals')
  revalidatePath('/dashboard')
  return { ok: true as const }
}

export async function voidInvoice(id: string, reason: string): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()
  const { error } = await admin
    .from('invoices')
    .update({
      status: 'void',
      void_reason: reason,
      void_by: auth.userId,
      void_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return { error: 'Error al anular la factura' as const }
  revalidatePath('/billing/invoices')
  revalidatePath(`/billing/invoices/${id}`)
  return { ok: true as const }
}

/**
 * Devuelve el id de un billing_cycle con status='scheduled' para el cliente,
 * creándolo si no existe. Usado cuando el admin factura el "siguiente ciclo"
 * desde el InvoiceForm y aún no hay un scheduled pre-creado por el cron.
 */
export async function ensureScheduledCycle(
  clientId: string,
): Promise<{ error: string } | { ok: true; cycleId: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()

  // Necesitamos current ANTES de evaluar si el scheduled existente es válido
  const [{ data: clientRow }, { data: currentRow }, { data: existing }] = await Promise.all([
    admin.from('clients').select('*').eq('id', clientId).single(),
    admin
      .from('billing_cycles')
      .select('id, period_start, period_end')
      .eq('client_id', clientId)
      .eq('status', 'current')
      .maybeSingle(),
    admin
      .from('billing_cycles')
      .select('id, period_start, period_end')
      .eq('client_id', clientId)
      .eq('status', 'scheduled')
      .maybeSingle(),
  ])
  const client = clientRow as Client | null
  const current = currentRow as Pick<BillingCycle, 'id' | 'period_start' | 'period_end'> | null
  if (!client) return { error: 'Cliente no encontrado' as const }
  if (!current) return { error: 'El cliente no tiene un ciclo activo' as const }

  // Defensa: si existe un scheduled cuya period_start NO es posterior al
  // period_end del current, está stale (creado antes de una promoción y
  // nunca limpiado). Archivarlo para que abajo creemos uno con fechas correctas.
  if (existing?.id) {
    const existingStart = existing.period_start as string
    const isStale = existingStart <= (current.period_end as string)
    if (!isStale) {
      return { ok: true as const, cycleId: existing.id as string }
    }
    await admin
      .from('billing_cycles')
      .update({ status: 'archived' })
      .eq('id', existing.id)
  }

  const { data: planRow } = await admin
    .from('plans')
    .select('*')
    .eq('id', client.current_plan_id ?? '')
    .maybeSingle()
  const plan = planRow as Plan | null
  if (!plan) return { error: 'El cliente no tiene un plan asignado' as const }

  const { periodStart, periodEnd } = nextCycleDates(current.period_end, {
    billingPeriod: client.billing_period,
  })

  const snapshot = plan.unified_content_limit != null
    ? { ...(plan.limits_json ?? {}), unified_content_limit: plan.unified_content_limit }
    : plan.limits_json

  const { data: inserted, error } = await admin
    .from('billing_cycles')
    .insert({
      client_id: client.id,
      plan_id_snapshot: plan.id,
      limits_snapshot_json: snapshot,
      rollover_from_previous_json: null,
      period_start: periodStart,
      period_end: periodEnd,
      status: 'scheduled',
      payment_status: 'unpaid',
      billing_period: plan.billing_period ?? 'monthly',
      no_expira: plan.no_expira ?? false,
    })
    .select('id')
    .single()

  if (error || !inserted?.id) return { error: 'Error al crear el ciclo programado' as const }
  return { ok: true as const, cycleId: inserted.id as string }
}

export async function deleteInvoiceDraft(id: string): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()
  const { data: inv } = await admin.from('invoices').select('status').eq('id', id).single()
  if (!inv) return { error: 'Factura no encontrada' as const }
  if (inv.status !== 'draft') return { error: 'Solo se pueden eliminar borradores' as const }
  const { error } = await admin.from('invoices').delete().eq('id', id)
  if (error) return { error: 'Error al eliminar el borrador' as const }
  revalidatePath('/billing/invoices')
  return { ok: true as const }
}

/**
 * Borra permanentemente una factura anulada (status='void').
 * Borra primero invoice_items para no dejar huérfanos.
 * Solo admins.
 */
export async function deleteVoidInvoice(id: string): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()
  const { data: inv } = await admin.from('invoices').select('status').eq('id', id).single()
  if (!inv) return { error: 'Factura no encontrada' as const }
  if (inv.status !== 'void') {
    return { error: 'Solo se pueden borrar facturas anuladas' as const }
  }

  const { error: itemsErr } = await admin.from('invoice_items').delete().eq('invoice_id', id)
  if (itemsErr) return { error: 'Error al borrar los ítems de la factura' as const }

  const { error } = await admin.from('invoices').delete().eq('id', id)
  if (error) return { error: 'Error al borrar la factura anulada' as const }

  revalidatePath('/billing/invoices')
  return { ok: true as const }
}

// ── n1co-specific actions ────────────────────────────────────

/**
 * Regenera un payment link n1co para una factura existente.
 * Útil cuando el link expiró o el monto cambió.
 */
export async function regenerateN1coLink(
  invoiceId: string,
): Promise<{ error: string } | { ok: true; paymentLinkUrl: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()

  const res = await regenerateInvoiceLinkCore(admin, invoiceId)
  if ('error' in res) return { error: res.error }

  revalidatePath(`/billing/invoices/${invoiceId}`)
  return { ok: true as const, paymentLinkUrl: res.paymentLinkUrl }
}

/**
 * Asigna manualmente un evento de pago huérfano a una factura.
 * Llama al core de "marcar pagada" reusando los datos del payload original.
 */
export async function assignOrphanPayment(
  args: { eventId: string; invoiceId: string },
): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()

  const { data: event } = await admin
    .from('n1co_payment_events')
    .select('id, raw_payload_json, processed, order_id, buyer_email, buyer_name')
    .eq('id', args.eventId)
    .single()
  if (!event) return { error: 'Evento no encontrado' as const }

  const result = await markInvoicePaidCore(admin, {
    invoiceId: args.invoiceId,
    paymentMethod: 'card',
    paymentReference: event.order_id as string | null,
    n1co: {
      orderId: event.order_id as string | null,
      buyerEmail: event.buyer_email as string | null,
      buyerName: event.buyer_name as string | null,
      paidAt: new Date().toISOString(),
    },
  })
  if (!result.ok) return { error: result.error ?? 'Error al marcar la factura como pagada' }

  await admin
    .from('n1co_payment_events')
    .update({
      matched_invoice_id: args.invoiceId,
      matched_client_id: result.clientId ?? null,
      matching_strategy: 'manual',
      processed: true,
      process_error: null,
    })
    .eq('id', args.eventId)

  revalidatePath('/billing/orphan-payments')
  revalidatePath(`/billing/invoices/${args.invoiceId}`)
  return { ok: true as const }
}

/**
 * Registra manualmente los datos del DTE emitido por n1co (o por otro proveedor)
 * sobre una factura ya pagada. El admin entra al portal de n1co, copia los datos
 * y los pega en el form del CRM.
 */
export async function registerDteData(args: {
  invoiceId: string
  codigoGeneracion: string | null
  numeroControl: string | null
  selloRecepcion: string | null
  tipo: DteTipo | null
  pdfUrl: string | null
}): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()

  // Validación mínima de UUID en codigoGeneracion (formato MH)
  if (args.codigoGeneracion && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.codigoGeneracion)) {
    return { error: 'Código de generación con formato inválido (debe ser UUID v4)' }
  }

  const { error } = await admin
    .from('invoices')
    .update({
      dte_codigo_generacion: args.codigoGeneracion,
      dte_numero_control: args.numeroControl,
      dte_sello_recepcion: args.selloRecepcion,
      dte_tipo: args.tipo,
      dte_pdf_url: args.pdfUrl,
      dte_received_at: args.codigoGeneracion ? new Date().toISOString() : null,
    })
    .eq('id', args.invoiceId)
  if (error) return { error: 'Error al guardar los datos del DTE' as const }

  revalidatePath(`/billing/invoices/${args.invoiceId}`)
  return { ok: true as const }
}
