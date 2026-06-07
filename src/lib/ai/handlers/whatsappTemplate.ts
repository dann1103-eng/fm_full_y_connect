import { sendWhatsappTemplate, type WaTemplateKey } from '@/lib/whatsapp/templates'
import type { AiHandler } from '@/lib/ai/types'

interface TemplateInput {
  /** Conversación destino. Si no existe se crea automáticamente. */
  phoneE164?: string
  conversationId?: string
  /** Cliente vinculado (para registro). Opcional si la conv ya está vinculada. */
  clientId?: string
  /** Template key declarada en WA_TEMPLATES. */
  templateKey?: WaTemplateKey
  /** Valores nombrados que coinciden con `paramKeys` de la plantilla. */
  params?: Record<string, string>
}

/**
 * Envía una plantilla aprobada de WhatsApp y deja registro en wa_messages.
 * Crea la conversación si no existe.
 */
export const whatsappTemplateHandler: AiHandler<TemplateInput, {
  messageId: string | null
  conversationId: string
  ok: boolean
  skipped?: string
}> = async (ctx, input) => {
  const phoneE164 = input.phoneE164
  const templateKey = input.templateKey
  const params = input.params ?? {}
  const clientId = input.clientId ?? ctx.job.client_id ?? null

  if (!templateKey) throw new Error('whatsapp_template: templateKey requerido')
  if (!phoneE164 && !input.conversationId) {
    throw new Error('whatsapp_template: se requiere phoneE164 o conversationId')
  }

  // 1. Resolver conversación (crear si no existe).
  let conversationId = input.conversationId ?? null
  if (!conversationId && phoneE164) {
    const existing = await ctx.supabase
      .from('wa_conversations')
      .select('id')
      .eq('phone_e164', phoneE164)
      .maybeSingle()
    if (existing.data) {
      conversationId = (existing.data as { id: string }).id
    } else {
      const created = await ctx.supabase
        .from('wa_conversations')
        .insert({ phone_e164: phoneE164, client_id: clientId })
        .select('id')
        .single()
      if (created.error || !created.data) {
        throw new Error(`whatsapp_template: no se pudo crear conv: ${created.error?.message}`)
      }
      conversationId = (created.data as { id: string }).id
    }
  }
  if (!conversationId) throw new Error('whatsapp_template: no se pudo resolver conversationId')

  // 2. Si conv tiene phone y no se pasó, leerlo.
  let resolvedPhone = phoneE164
  if (!resolvedPhone) {
    const cv = await ctx.supabase
      .from('wa_conversations')
      .select('phone_e164')
      .eq('id', conversationId)
      .maybeSingle()
    resolvedPhone = (cv.data as { phone_e164: string } | null)?.phone_e164
  }
  if (!resolvedPhone) throw new Error('whatsapp_template: phone_e164 no resuelto')

  await ctx.logEvent('progress', { step: 'sending_template', templateKey, conversationId })

  // 3. Enviar.
  const send = await sendWhatsappTemplate({ toE164: resolvedPhone, templateKey, params })
  const now = new Date().toISOString()

  // 4. Persistir.
  const insert = await ctx.supabase
    .from('wa_messages')
    .insert({
      conversation_id: conversationId,
      direction: 'outbound',
      wamid: send.wamid,
      msg_type: 'template',
      body: `[plantilla: ${templateKey}] ${JSON.stringify(params)}`,
      sent_by: 'system',
      ai_job_id: ctx.job.id,
      wa_status: send.ok ? 'sent' : 'failed',
      wa_error_json: send.ok ? null : send.raw,
      raw_json: send.raw,
      created_at: now,
    })
    .select('id')
    .single()

  await ctx.supabase
    .from('wa_conversations')
    .update({ last_message_at: now, last_message_preview: `📨 ${templateKey}` })
    .eq('id', conversationId)

  if (!send.ok) await ctx.logEvent('whatsapp_template_failed', { error: send.errorText })

  return {
    messageId: insert.data?.id ?? null,
    conversationId,
    ok: send.ok,
    skipped: send.ok ? undefined : 'template_send_failed',
  }
}
