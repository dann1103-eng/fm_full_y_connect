import { createAdminClient } from '@/lib/supabase/admin'
import { createWaAdminClient } from '@/lib/whatsapp/db'
import { renderInvoicePdfBuffer } from '@/lib/billing/invoice-pdf'
import { uploadWhatsappMedia } from '@/lib/whatsapp/media-upload'
import { sendWhatsappDocument } from '@/lib/whatsapp/send'
import {
  createIssuedInvoiceWithLink,
  regenerateInvoiceLinkCore,
  ensureScheduledCycleCore,
} from '@/lib/domain/invoice-create'
import { EXTRA_CONTENT_PRICES, CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import { suggestItemsFromPlan } from '@/lib/domain/invoices'
import { invoicePeriodLabel } from '@/lib/domain/billing'
import type { Client, ContentType, Plan } from '@/types/db'

/**
 * Cores de facturación para el bot de WhatsApp. Todos scoped por clientId
 * (resuelto desde wa_conversations, nunca del texto del cliente). Reutilizan la
 * lógica fiscal compartida (invoice-create.ts) — misma que el portal.
 *
 * NUNCA aceptan montos ni ítems arbitrarios del cliente: solo catálogo fijo.
 */

type Admin = ReturnType<typeof createAdminClient>

const CAMBIOS_PACKAGE_SIZE = 5
const CAMBIOS_PACKAGE_PRICE = 25

async function loadClientWithPlan(
  admin: Admin,
  clientId: string,
): Promise<{ client: Client; plan: Plan | null } | { error: string }> {
  const { data: clientRow } = await admin.from('clients').select('*').eq('id', clientId).single()
  const client = clientRow as Client | null
  if (!client) return { error: 'Cliente no encontrado.' }
  if (client.status === 'inactive_payment' || client.status === 'inactive_manual') {
    return { error: 'La cuenta está inactiva. Un humano del equipo debe ayudarte.' }
  }
  const { data: planRow } = client.current_plan_id
    ? await admin.from('plans').select('*').eq('id', client.current_plan_id).maybeSingle()
    : { data: null }
  return { client, plan: (planRow as Plan | null) ?? null }
}

async function currentCycleId(admin: Admin, clientId: string): Promise<string | null> {
  const { data } = await admin
    .from('billing_cycles')
    .select('id')
    .eq('client_id', clientId)
    .eq('status', 'current')
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

// ── Carril A: reenviar/regenerar link de una factura ya emitida ──────────────

/**
 * Devuelve un payment link fresco para la factura impaga del cliente (la más
 * reciente, o `invoiceId` específico). Regenera siempre el link para evitar uno
 * expirado. NO crea facturas — cero correlativo/DTE.
 */
export async function sendPaymentLinkForClient(
  clientId: string,
  invoiceId?: string,
): Promise<{ ok: true; invoiceId: string; invoiceNumber: string; totalAPagar: number; paymentLinkUrl: string } | { error: string }> {
  const admin = createAdminClient()

  let invId: string
  let invoiceNumber: string
  let totalAPagar: number

  if (invoiceId) {
    const { data } = await admin
      .from('invoices')
      .select('id, invoice_number, total_a_pagar, total, client_id, status, payment_date')
      .eq('id', invoiceId)
      .maybeSingle()
    if (!data || data.client_id !== clientId) return { error: 'Esa factura no existe o no es de este cliente.' }
    if (data.status === 'paid' || data.payment_date) return { error: 'Esa factura ya está pagada.' }
    if (data.status === 'void') return { error: 'Esa factura fue anulada.' }
    invId = data.id
    invoiceNumber = data.invoice_number
    totalAPagar = data.total_a_pagar ?? data.total
  } else {
    const { data } = await admin
      .from('invoices')
      .select('id, invoice_number, total_a_pagar, total')
      .eq('client_id', clientId)
      .eq('status', 'issued')
      .is('payment_date', null)
      .order('issue_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!data) return { error: 'No tienes facturas pendientes de pago.' }
    invId = data.id
    invoiceNumber = data.invoice_number
    totalAPagar = data.total_a_pagar ?? data.total
  }

  const res = await regenerateInvoiceLinkCore(admin, invId)
  if ('error' in res) return { error: res.error }
  return { ok: true, invoiceId: invId, invoiceNumber, totalAPagar, paymentLinkUrl: res.paymentLinkUrl }
}

// ── Carril B: extras de catálogo (contenido / cambios) ───────────────────────

/** Emite factura + link por N unidades de un contenido tippable a precio de catálogo. */
export async function createExtraContentInvoiceForClient(
  clientId: string,
  contentType: ContentType,
  qty: number,
): Promise<{ ok: true; invoiceId: string; invoiceNumber: string; totalAPagar: number; paymentLinkUrl: string | null } | { error: string }> {
  if (!Number.isInteger(qty) || qty <= 0 || qty > 20) return { error: 'Cantidad inválida (1 a 20).' }
  const unitPrice = EXTRA_CONTENT_PRICES[contentType]
  if (!unitPrice) return { error: 'Ese tipo de contenido no se vende como extra.' }

  const admin = createAdminClient()
  const loaded = await loadClientWithPlan(admin, clientId)
  if ('error' in loaded) return { error: loaded.error }
  const { client, plan } = loaded

  const label = CONTENT_TYPE_LABELS[contentType]
  const description = `${label} adicional${qty > 1 ? ` (×${qty})` : ''}`

  return createIssuedInvoiceWithLink(admin, {
    client,
    plan,
    items: [{ description, quantity: qty, unit_price: unitPrice }],
    billingCycleId: await currentCycleId(admin, clientId),
    dueDate: null,
    notes: `Contenido extra solicitado por el cliente vía WhatsApp · Plan ${plan?.name ?? '—'}`,
    extrasMetadata: { kind: 'content', content_type: contentType, qty },
    linkPlanName: `${label} adicional`,
    extraMetadataForLink: [
      { name: 'extraKind', value: 'content' },
      { name: 'extraContentType', value: contentType },
      { name: 'extraQty', value: String(qty) },
    ],
  })
}

/** Emite factura + link por N paquetes estándar de 5 cambios a precio de catálogo. */
export async function createExtraCambiosInvoiceForClient(
  clientId: string,
  packages: number,
): Promise<{ ok: true; invoiceId: string; invoiceNumber: string; totalAPagar: number; paymentLinkUrl: string | null } | { error: string }> {
  if (!Number.isInteger(packages) || packages <= 0 || packages > 10) return { error: 'Cantidad de paquetes inválida (1 a 10).' }

  const admin = createAdminClient()
  const loaded = await loadClientWithPlan(admin, clientId)
  if ('error' in loaded) return { error: loaded.error }
  const { client, plan } = loaded

  const totalCambios = CAMBIOS_PACKAGE_SIZE * packages
  const description =
    packages > 1
      ? `${packages} paquetes de ${CAMBIOS_PACKAGE_SIZE} cambios adicionales`
      : `Paquete de ${CAMBIOS_PACKAGE_SIZE} cambios adicionales`

  return createIssuedInvoiceWithLink(admin, {
    client,
    plan,
    items: [{ description, quantity: packages, unit_price: CAMBIOS_PACKAGE_PRICE }],
    billingCycleId: await currentCycleId(admin, clientId),
    dueDate: null,
    notes: `Paquete de cambios extra solicitado por el cliente vía WhatsApp · Plan ${plan?.name ?? '—'}`,
    extrasMetadata: { kind: 'cambios', qty: totalCambios },
    linkPlanName: plan ? `${plan.name} · cambios extras` : 'Cambios extras',
    extraMetadataForLink: [
      { name: 'extraKind', value: 'cambios' },
      { name: 'extraQty', value: String(totalCambios) },
    ],
  })
}

// ── Carril B: renovación del plan (solo monthly; otros → handoff) ────────────

/**
 * Emite la factura de RENOVACIÓN del próximo ciclo del cliente + su link.
 * Solo automatiza planes `monthly` (1 factura, precio completo). Para biweekly/
 * bimonthly devuelve `needsHuman` porque su lógica de medios/2 pagos es delicada
 * y cobrar mal es grave. Idempotente: si ya hay factura emitida e impaga para el
 * ciclo programado, reutiliza esa (regenera el link) en vez de crear otra.
 */
export async function createRenewalInvoiceForClient(
  clientId: string,
): Promise<
  | { ok: true; invoiceId: string; invoiceNumber: string; totalAPagar: number; paymentLinkUrl: string | null; reused: boolean }
  | { needsHuman: true; reason: string }
  | { error: string }
> {
  const admin = createAdminClient()
  const loaded = await loadClientWithPlan(admin, clientId)
  if ('error' in loaded) return { error: loaded.error }
  const { client, plan } = loaded
  if (!plan) return { error: 'El cliente no tiene un plan asignado.' }

  if (client.billing_period !== 'monthly') {
    return {
      needsHuman: true,
      reason: `La renovación de un plan ${client.billing_period} la gestiona el equipo (pagos por quincena/bimestre).`,
    }
  }

  const scheduled = await ensureScheduledCycleCore(admin, clientId)
  if ('error' in scheduled) return { error: scheduled.error }

  // Idempotencia: reusar una factura ya emitida e impaga para ese ciclo.
  const { data: existingInv } = await admin
    .from('invoices')
    .select('id, invoice_number, total_a_pagar, total')
    .eq('billing_cycle_id', scheduled.cycleId)
    .eq('status', 'issued')
    .is('payment_date', null)
    .order('issue_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existingInv) {
    const link = await regenerateInvoiceLinkCore(admin, existingInv.id)
    if ('error' in link) return { error: link.error }
    return {
      ok: true,
      invoiceId: existingInv.id,
      invoiceNumber: existingInv.invoice_number,
      totalAPagar: existingInv.total_a_pagar ?? existingInv.total,
      paymentLinkUrl: link.paymentLinkUrl,
      reused: true,
    }
  }

  const periodLabel = invoicePeriodLabel(scheduled.periodStart, scheduled.periodEnd, 'monthly', null)
  const res = await createIssuedInvoiceWithLink(admin, {
    client,
    plan,
    items: suggestItemsFromPlan(plan, periodLabel),
    billingCycleId: scheduled.cycleId,
    dueDate: scheduled.periodStart,
    notes: `Renovación del plan solicitada por el cliente vía WhatsApp · ${plan.name}`,
    extrasMetadata: null,
    linkPlanName: plan.name,
    paymentProvider: 'n1co_link',
  })
  if ('error' in res) return { error: res.error }

  // Marcar el ciclo programado como auto-facturado para que el cron no genere
  // una segunda factura del mismo período.
  await admin.from('billing_cycles').update({ auto_billed_at: new Date().toISOString() }).eq('id', scheduled.cycleId)

  return { ...res, reused: false }
}

/**
 * Envía al cliente el PDF de una de SUS facturas por WhatsApp, como documento
 * adjunto en la conversación.
 *
 * Va como mensaje libre (no plantilla) porque el cliente acaba de escribir: la
 * ventana de 24h de Meta está abierta. Reutiliza la infra construida para el
 * recordatorio de vencimiento (render sin sesión + upload a Meta).
 *
 * Alcance: cualquier factura EMITIDA del cliente (issued o paid), de ciclo o de
 * extras. Se excluyen draft (aún no es documento fiscal) y void (anulada).
 * El scope por clientId es obligatorio: nunca se resuelve una factura desde el
 * texto del cliente sin validar que le pertenece.
 */
export async function sendInvoiceDocumentToClient(args: {
  clientId: string
  phoneE164: string
  conversationId: string
  invoiceId?: string
  invoiceNumber?: string
}): Promise<
  | { ok: true; invoiceNumber: string; totalAPagar: number; status: string }
  | { error: string }
> {
  const admin = createAdminClient()

  let query = admin
    .from('invoices')
    .select('id, invoice_number, client_id, total, total_a_pagar, status, issue_date')
    .eq('client_id', args.clientId)
    .in('status', ['issued', 'paid'])

  if (args.invoiceId) query = query.eq('id', args.invoiceId)
  else if (args.invoiceNumber) query = query.eq('invoice_number', args.invoiceNumber)

  const { data: rows } = await query.order('issue_date', { ascending: false }).limit(1)
  const inv = (rows ?? [])[0]
  if (!inv) {
    return {
      error: args.invoiceId || args.invoiceNumber
        ? 'No encontré esa factura entre las de este cliente.'
        : 'Este cliente todavía no tiene facturas emitidas.',
    }
  }

  const pdf = await renderInvoicePdfBuffer(admin, inv.id as string)
  if (!pdf) return { error: 'No se pudo generar el PDF de la factura.' }

  const filename = `Factura-${inv.invoice_number}.pdf`
  const media = await uploadWhatsappMedia({
    buffer: pdf.buffer,
    filename,
    mimeType: 'application/pdf',
  })
  if (!media.ok || !media.mediaId) {
    return { error: 'No se pudo preparar el archivo para enviarlo por WhatsApp.' }
  }

  const send = await sendWhatsappDocument({
    toE164: args.phoneE164,
    mediaId: media.mediaId,
    filename,
  })
  if (!send.ok) return { error: 'No se pudo enviar el documento por WhatsApp.' }

  // Registrar el saliente para que el staff lo vea en el inbox.
  const wa = createWaAdminClient()
  const now = new Date().toISOString()
  await wa.from('wa_messages').insert({
    conversation_id: args.conversationId,
    direction: 'outbound',
    wamid: send.wamid,
    msg_type: 'document',
    sent_by: 'bot',
    body: `Factura ${inv.invoice_number} (PDF enviado al cliente)`,
    wa_status: 'sent',
    raw_json: send.raw,
    created_at: now,
  })

  return {
    ok: true,
    invoiceNumber: String(inv.invoice_number),
    totalAPagar: Number(inv.total_a_pagar ?? inv.total ?? 0),
    status: String(inv.status),
  }
}
