import { createAdminClient } from '@/lib/supabase/admin'
import { createIssuedInvoiceWithLink, regenerateInvoiceLinkCore } from '@/lib/domain/invoice-create'
import { EXTRA_CONTENT_PRICES, CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
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
