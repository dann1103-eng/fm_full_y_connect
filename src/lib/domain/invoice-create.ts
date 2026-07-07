import type { SupabaseClient } from '@supabase/supabase-js'
import type { Client, CompanySettings, InvoiceExtrasMetadata, Plan } from '@/types/db'
import { buildClientSnapshot, buildEmitterSnapshot, calculateTotals, type LineItemInput } from '@/lib/domain/invoices'
import { today as todayString } from '@/lib/domain/dates'
import { createInvoicePaymentLink, extractPaymentLinkId } from '@/lib/n1co/payment-links'
import { N1coApiError } from '@/lib/n1co/types'

/**
 * Cores fiscales COMPARTIDOS para crear una factura EMITIDA con su payment link
 * n1co, y para regenerar el link de una factura existente. Sin gate de sesión:
 * el caller (portal self-service, bot de WhatsApp) valida la identidad/scope.
 *
 * Un solo lugar para esta lógica evita drift entre el auto-servicio del portal y
 * el del bot (código fiscal duplicado = fuente de bugs de dinero).
 */

type Admin = SupabaseClient

async function loadEmitter(admin: Admin): Promise<CompanySettings | null> {
  const { data } = await admin.from('company_settings').select('*').limit(1).maybeSingle()
  return (data as CompanySettings | null) ?? null
}

export interface CreateIssuedInvoiceArgs {
  client: Client
  plan: Plan | null
  items: LineItemInput[]
  /** Ciclo asociado (renovación) o null (extras one-off). */
  billingCycleId: string | null
  dueDate: string | null
  notes: string
  extrasMetadata: InvoiceExtrasMetadata | null
  /** Nombre a mostrar en el link n1co (ej. "Plan X · cambios extras"). */
  linkPlanName?: string | null
  /** Metadata extra para el webhook (extraKind/extraQty/…). */
  extraMetadataForLink?: { name: string; value: string }[]
}

export type CreateIssuedInvoiceResult =
  | { ok: true; invoiceId: string; invoiceNumber: string; totalAPagar: number; paymentLinkUrl: string | null }
  | { error: string }

/**
 * Crea una factura EMITIDA (status='issued', payment_provider='n1co_link_oneoff')
 * + sus ítems + el payment link dinámico. Mismo flujo que purchaseExtraContent del
 * portal. El pago se reconcilia solo por el webhook (orderReference=invoice.id).
 */
export async function createIssuedInvoiceWithLink(
  admin: Admin,
  args: CreateIssuedInvoiceArgs,
): Promise<CreateIssuedInvoiceResult> {
  if (!args.items.length) return { error: 'La factura debe tener al menos un ítem' }

  const emitter = await loadEmitter(admin)
  if (!emitter) return { error: 'Configuración del emisor no inicializada' }

  const client = args.client
  const retentionRate = client.aplica_renta_retenida ? 0.1 : 0
  const totals = calculateTotals({
    items: args.items,
    tax_rate: client.default_tax_rate ?? 0.13,
    discount_amount: 0,
    retention_rate: retentionRate,
  })

  const { data: numberRow, error: numberErr } = await admin.rpc('next_invoice_number')
  if (numberErr || !numberRow) return { error: 'Error al generar el correlativo' }
  const invoiceNumber = numberRow as unknown as string

  const hasN1co = !!process.env.N1CO_CHECKOUT_LINK_SECRET

  const { data: inserted, error: insertErr } = await admin
    .from('invoices')
    .insert({
      invoice_number: invoiceNumber,
      client_id: client.id,
      billing_cycle_id: args.billingCycleId,
      issue_date: todayString(),
      due_date: args.dueDate,
      currency: 'USD',
      subtotal: totals.subtotal,
      discount_amount: totals.discount_amount,
      tax_rate: client.default_tax_rate ?? 0.13,
      tax_amount: totals.tax_amount,
      retention_rate: totals.retention_rate,
      retencion_renta_amount: totals.retencion_renta_amount,
      total: totals.total,
      total_a_pagar: totals.total_a_pagar,
      status: 'issued',
      notes: args.notes,
      client_snapshot_json: buildClientSnapshot(client),
      emitter_snapshot_json: buildEmitterSnapshot(emitter),
      payment_provider: hasN1co ? 'n1co_link_oneoff' : 'manual',
      extras_metadata: args.extrasMetadata,
    })
    .select('id, invoice_number, total, total_a_pagar, currency, billing_cycle_id')
    .single()
  if (insertErr || !inserted) return { error: 'Error al crear la factura' }

  const { error: itemsErr } = await admin.from('invoice_items').insert(
    totals.items.map((it) => ({
      invoice_id: inserted.id,
      description: it.description,
      quantity: it.quantity,
      unit_price: it.unit_price,
      line_total: it.line_total,
      sort_order: it.sort_order,
    })),
  )
  if (itemsErr) {
    await admin.from('invoices').delete().eq('id', inserted.id)
    return { error: 'Error al guardar los ítems de la factura' }
  }

  let paymentLinkUrl: string | null = null
  if (hasN1co) {
    try {
      const link = await createInvoicePaymentLink({
        invoice: {
          id: inserted.id as string,
          invoice_number: inserted.invoice_number as string,
          currency: inserted.currency as string,
          billing_cycle_id: inserted.billing_cycle_id as string | null,
        },
        amount: (inserted.total_a_pagar ?? inserted.total) as number,
        client: { id: client.id, name: client.name },
        plan: args.plan ? { id: args.plan.id, name: args.linkPlanName ?? args.plan.name } : null,
        locationCode: emitter.n1co_location_code ?? undefined,
        dueDate: args.dueDate,
        extraMetadata: args.extraMetadataForLink,
      })
      paymentLinkUrl = link.paymentLinkUrl
      await admin
        .from('invoices')
        .update({
          n1co_payment_link_url: link.paymentLinkUrl,
          n1co_payment_link_id: extractPaymentLinkId(link.paymentLinkUrl) ?? String(link.orderId),
          n1co_order_reference: inserted.id as string,
        })
        .eq('id', inserted.id)
    } catch (err) {
      if (err instanceof N1coApiError) {
        console.error('[invoice-create] n1co link error', err.status, err.body)
      } else {
        console.error('[invoice-create] n1co link error', err)
      }
      // Sin link: dejamos la factura emitida pero en 'manual' para que el staff la gestione.
      await admin.from('invoices').update({ payment_provider: 'manual' }).eq('id', inserted.id)
      return { error: 'No se pudo generar el enlace de pago. La factura quedó emitida; el equipo la revisará.' }
    }
  }

  return {
    ok: true,
    invoiceId: inserted.id as string,
    invoiceNumber,
    totalAPagar: (inserted.total_a_pagar ?? inserted.total) as number,
    paymentLinkUrl,
  }
}

/**
 * Regenera el payment link n1co de una factura existente (impaga). Core sin gate:
 * lo usan `regenerateN1coLink` (admin) y el bot (`send_payment_link`, scope validado).
 */
export async function regenerateInvoiceLinkCore(
  admin: Admin,
  invoiceId: string,
): Promise<{ ok: true; paymentLinkUrl: string } | { error: string }> {
  const { data: inv } = await admin
    .from('invoices')
    .select('id, invoice_number, total, total_a_pagar, currency, billing_cycle_id, client_id, status, due_date')
    .eq('id', invoiceId)
    .single()
  if (!inv) return { error: 'Factura no encontrada' }
  if (inv.status === 'paid' || inv.status === 'void') {
    return { error: 'No se puede regenerar el link de una factura pagada o anulada' }
  }

  const [{ data: clientRow }, emitter] = await Promise.all([
    admin.from('clients').select('id, name, current_plan_id').eq('id', inv.client_id).single(),
    loadEmitter(admin),
  ])
  if (!clientRow) return { error: 'Cliente no encontrado' }

  const { data: planRow } = clientRow.current_plan_id
    ? await admin.from('plans').select('id, name').eq('id', clientRow.current_plan_id).maybeSingle()
    : { data: null }

  try {
    const link = await createInvoicePaymentLink({
      invoice: {
        id: inv.id as string,
        invoice_number: inv.invoice_number as string,
        currency: inv.currency as string,
        billing_cycle_id: inv.billing_cycle_id as string | null,
      },
      amount: (inv.total_a_pagar ?? inv.total) as number,
      client: { id: clientRow.id as string, name: clientRow.name as string },
      plan: (planRow as { id: string; name: string } | null) ?? null,
      locationCode: emitter?.n1co_location_code ?? undefined,
      dueDate: inv.due_date as string | null,
    })
    await admin
      .from('invoices')
      .update({
        n1co_payment_link_url: link.paymentLinkUrl,
        n1co_payment_link_id: extractPaymentLinkId(link.paymentLinkUrl) ?? String(link.orderId),
        n1co_order_reference: inv.id as string,
        payment_provider: 'n1co_link',
      })
      .eq('id', invoiceId)
    return { ok: true, paymentLinkUrl: link.paymentLinkUrl }
  } catch (err) {
    if (err instanceof N1coApiError) {
      console.error('[invoice-create] regenerate link error', err.status, err.body)
    } else {
      console.error('[invoice-create] regenerate link error', err)
    }
    return { error: 'No se pudo generar el enlace de pago con la pasarela.' }
  }
}
