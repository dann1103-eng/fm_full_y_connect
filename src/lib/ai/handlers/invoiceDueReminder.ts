import { createAdminClient } from '@/lib/supabase/admin'
import { createWaAdminClient } from '@/lib/whatsapp/db'
import { renderInvoicePdfBuffer } from '@/lib/billing/invoice-pdf'
import { uploadWhatsappMedia } from '@/lib/whatsapp/media-upload'
import { sendWhatsappTemplate } from '@/lib/whatsapp/templates'
import { resolveWaConversation } from '@/lib/whatsapp/conversation'
import { regenerateInvoiceLinkCore } from '@/lib/domain/invoice-create'
import { formatDateEs } from '@/lib/domain/dates'
import type { AiHandler } from '@/lib/ai/types'

interface DueReminderInput {
  invoiceId?: string
  phoneE164?: string
  clientId?: string
}

/**
 * Envía el recordatorio "tu factura está por vencer" con el PDF adjunto.
 *
 * Diseño: docs/superpowers/specs/2026-07-25-recordatorio-factura-por-vencer-design.md
 */
export const invoiceDueReminderHandler: AiHandler<DueReminderInput, {
  sent: boolean
  skipped?: string
}> = async (ctx, input) => {
  const jobInput = ctx.job.input_json as DueReminderInput
  const invoiceId = input.invoiceId ?? jobInput.invoiceId
  if (!invoiceId) throw new Error('invoice_due_reminder: invoiceId requerido')

  const admin = createAdminClient()

  // 1. Estado actual: pudo pagarse entre el encolado y ahora.
  const { data: inv } = await admin
    .from('invoices')
    .select('id, invoice_number, client_id, total, total_a_pagar, due_date, status, payment_date, due_reminder_sent_at')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!inv) throw new Error(`invoice_due_reminder: factura ${invoiceId} no existe`)

  if (inv.status !== 'issued' || inv.payment_date) {
    await ctx.logEvent('skipped', { reason: 'invoice_not_payable', status: inv.status })
    return { sent: false, skipped: 'invoice_not_payable' }
  }
  if (inv.due_reminder_sent_at) {
    await ctx.logEvent('skipped', { reason: 'already_reminded' })
    return { sent: false, skipped: 'already_reminded' }
  }
  if (!inv.due_date) {
    await ctx.logEvent('skipped', { reason: 'sin_due_date' })
    return { sent: false, skipped: 'sin_due_date' }
  }

  // 2. Destinatario. Se resuelve ANTES de trabajo caro para no gastar
  //    render + upload en una factura que no tiene a quién notificar.
  const wa = createWaAdminClient()
  let phoneE164 = input.phoneE164 ?? jobInput.phoneE164 ?? null
  if (!phoneE164) {
    const { data: contact } = await wa
      .from('client_whatsapp_contacts')
      .select('phone_e164')
      .eq('client_id', inv.client_id)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    phoneE164 = (contact as { phone_e164?: string } | null)?.phone_e164 ?? null
  }
  if (!phoneE164) {
    await ctx.logEvent('skipped', { reason: 'sin_contacto_whatsapp', clientId: inv.client_id })
    return { sent: false, skipped: 'sin_contacto_whatsapp' }
  }

  // 3. Enlace de pago vigente. El guardado suele estar expirado: se emite ~10
  //    días antes del vencimiento y (hasta el fix) moría a los 3.
  await ctx.logEvent('progress', { step: 'regenerando_link' })
  const link = await regenerateInvoiceLinkCore(admin, invoiceId)
  if ('error' in link) {
    throw new Error(`invoice_due_reminder: no se pudo generar el enlace de pago: ${link.error}`)
  }

  // 4. PDF → Meta.
  await ctx.logEvent('progress', { step: 'renderizando_pdf' })
  const pdf = await renderInvoicePdfBuffer(admin, invoiceId)
  if (!pdf) throw new Error('invoice_due_reminder: no se pudo renderizar el PDF')

  const filename = `Factura-${inv.invoice_number}.pdf`
  const media = await uploadWhatsappMedia({
    buffer: pdf.buffer,
    filename,
    mimeType: 'application/pdf',
  })
  if (!media.ok || !media.mediaId) {
    throw new Error(`invoice_due_reminder: upload a Meta falló: ${media.errorText}`)
  }

  const { data: client } = await admin
    .from('clients')
    .select('name')
    .eq('id', inv.client_id)
    .maybeSingle()

  // 5. MARCAR ANTES DE ENVIAR (at-most-once).
  //    Si marcáramos después, el watchdog de la migración 0124 reclamaría el job
  //    tras 5 min en 'processing' y reejecutaría el handler completo: el cliente
  //    recibiría un SEGUNDO cobro, facturable. Perder un recordatorio es
  //    preferible a duplicarlo.
  await admin
    .from('invoices')
    .update({ due_reminder_sent_at: new Date().toISOString() })
    .eq('id', invoiceId)

  const amount = `$${Number(inv.total_a_pagar ?? inv.total ?? 0).toFixed(2)}`
  await ctx.logEvent('progress', { step: 'enviando_plantilla', phoneE164 })

  const send = await sendWhatsappTemplate({
    toE164: phoneE164,
    templateKey: 'INVOICE_DUE_SOON',
    params: {
      // La MARCA, no el contacto: distingue recordatorios de dos marcas que
      // comparten el mismo número.
      client_name: client?.name ?? 'cliente',
      invoice_number: String(inv.invoice_number),
      amount,
      due_date: formatDateEs(inv.due_date),
      payment_url: link.paymentLinkUrl,
    },
    headerDocument: { mediaId: media.mediaId, filename },
  })

  // 6. Fallo explícito → limpiar el marcador para que el cron reintente mañana
  //    (mientras la factura siga dentro de la ventana).
  if (!send.ok) {
    await admin.from('invoices').update({ due_reminder_sent_at: null }).eq('id', invoiceId)
    await ctx.logEvent('due_reminder_failed', { error: send.errorText })
    throw new Error(`invoice_due_reminder: envío falló: ${send.errorText}`)
  }

  // 7. Registrar el saliente en el inbox del staff.
  const conversationId = await resolveWaConversation(wa, phoneE164, inv.client_id)
  const now = new Date().toISOString()
  await wa.from('wa_messages').insert({
    conversation_id: conversationId,
    direction: 'outbound',
    wamid: send.wamid,
    msg_type: 'document',
    sent_by: 'system',
    ai_job_id: ctx.job.id,
    body: `Recordatorio de pago — factura ${inv.invoice_number} (PDF adjunto)`,
    wa_status: 'sent',
    raw_json: send.raw,
    created_at: now,
  })
  await wa
    .from('wa_conversations')
    .update({ last_message_at: now, last_message_preview: '📄 Recordatorio de pago' })
    .eq('id', conversationId)

  return { sent: true }
}
