'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createWaAdminClient as createAdminClient } from '@/lib/whatsapp/db'
import { sendWhatsappText } from '@/lib/whatsapp/send'
import { sendWhatsappTemplate } from '@/lib/whatsapp/templates'
import { toE164 } from '@/lib/whatsapp/normalize'
import type { WaBotTool, WaBotAudience } from '@/types/db'

type Result<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string }

async function requireAgencyUser() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { ok: false as const, error: 'No autenticado' }

  const { data: user } = await supabase
    .from('users')
    .select('id,role')
    .eq('id', auth.user.id)
    .single()
  if (!user || user.role === 'client') {
    return { ok: false as const, error: 'No autorizado' }
  }
  return { ok: true as const, userId: user.id, role: user.role }
}

async function requireAdmin() {
  const guard = await requireAgencyUser()
  if (!guard.ok) return guard
  if (guard.role !== 'admin') return { ok: false as const, error: 'Solo admin' }
  return guard
}

// ────────────────────────────────────────────────────────────
// Pausar / reanudar bot en una conversación
// ────────────────────────────────────────────────────────────
export async function toggleBotForConversation(conversationId: string, paused: boolean): Promise<Result> {
  const guard = await requireAgencyUser()
  if (!guard.ok) return guard

  const admin = createAdminClient()
  const { error } = await admin
    .from('wa_conversations')
    .update({
      bot_paused: paused,
      paused_by: paused ? guard.userId : null,
      paused_at: paused ? new Date().toISOString() : null,
      // Reanudar el bot implica que el handoff ya fue atendido.
      ...(paused ? {} : { needs_attention: false, attention_reason: null, attention_at: null }),
    })
    .eq('id', conversationId)

  if (error) return { ok: false, error: error.message }
  revalidatePath(`/whatsapp/${conversationId}`)
  revalidatePath('/whatsapp')
  return { ok: true }
}

// ────────────────────────────────────────────────────────────
// Toggle global del bot por cliente
// ────────────────────────────────────────────────────────────
export async function toggleBotForClient(clientId: string, enabled: boolean): Promise<Result> {
  const guard = await requireAgencyUser()
  if (!guard.ok) return guard

  const admin = createAdminClient()
  const { error } = await admin
    .from('clients')
    .update({ wa_bot_enabled: enabled })
    .eq('id', clientId)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/whatsapp')
  revalidatePath(`/clients/${clientId}`)
  return { ok: true }
}

// ────────────────────────────────────────────────────────────
// Responder desde el inbox interno (staff)
// ────────────────────────────────────────────────────────────
export async function sendStaffReply(conversationId: string, body: string): Promise<Result<{ messageId: string }>> {
  const guard = await requireAgencyUser()
  if (!guard.ok) return guard

  const text = body.trim()
  if (!text) return { ok: false, error: 'Mensaje vacío' }
  if (text.length > 4096) return { ok: false, error: 'Mensaje demasiado largo (máx 4096 chars)' }

  const admin = createAdminClient()
  const conv = await admin
    .from('wa_conversations')
    .select('id,phone_e164,bot_paused')
    .eq('id', conversationId)
    .single()
  if (conv.error || !conv.data) return { ok: false, error: 'Conversación no encontrada' }

  // Pausar bot automáticamente: si el staff escribe, no queremos que el bot
  // hable encima en el siguiente mensaje del cliente.
  if (!conv.data.bot_paused) {
    await admin
      .from('wa_conversations')
      .update({ bot_paused: true, paused_by: guard.userId, paused_at: new Date().toISOString() })
      .eq('id', conversationId)
  }

  const send = await sendWhatsappText({ toE164: conv.data.phone_e164, body: text })
  if (!send.ok) {
    // Persistimos el intento fallido para auditoría.
    await admin.from('wa_messages').insert({
      conversation_id: conversationId,
      direction: 'outbound',
      msg_type: 'text',
      body: text,
      sent_by: 'staff',
      staff_user_id: guard.userId,
      wa_status: 'failed',
      wa_error_json: send.raw,
    })
    return { ok: false, error: `Meta API: ${send.errorText ?? 'falló el envío'}` }
  }

  const now = new Date().toISOString()
  const insert = await admin
    .from('wa_messages')
    .insert({
      conversation_id: conversationId,
      direction: 'outbound',
      wamid: send.wamid,
      msg_type: 'text',
      body: text,
      sent_by: 'staff',
      staff_user_id: guard.userId,
      wa_status: 'sent',
      raw_json: send.raw,
      created_at: now,
    })
    .select('id')
    .single()

  if (insert.error || !insert.data) return { ok: false, error: insert.error?.message ?? 'No se pudo registrar el mensaje' }

  await admin
    .from('wa_conversations')
    .update({
      last_message_at: now,
      last_message_preview: text.slice(0, 140),
      unread_count: 0,
      // El staff respondió → handoff atendido.
      needs_attention: false,
      attention_reason: null,
      attention_at: null,
    })
    .eq('id', conversationId)

  revalidatePath(`/whatsapp/${conversationId}`)
  revalidatePath('/whatsapp')
  return { ok: true, messageId: insert.data.id }
}

// ────────────────────────────────────────────────────────────
// Reabrir una conversación cuya ventana de 24h cerró (plantilla)
// ────────────────────────────────────────────────────────────
/**
 * Envía la plantilla de seguimiento comercial para retomar una conversación
 * fuera de la ventana de 24h (donde Meta rechaza el texto libre con 131047).
 *
 * Se dispara a mano desde el inbox: reabrir una conversación con un prospecto
 * es una decisión comercial, no algo que deba pasar solo.
 */
export async function sendLeadFollowupTemplate(
  conversationId: string,
  topic: string,
): Promise<Result<{ messageId: string }>> {
  const guard = await requireAgencyUser()
  if (!guard.ok) return guard

  const tema = topic.trim()
  if (!tema) return { ok: false, error: 'Escribe sobre qué tema das seguimiento.' }
  if (tema.length > 120) return { ok: false, error: 'El tema es demasiado largo (máx 120 chars).' }

  const admin = createAdminClient()
  const conv = await admin
    .from('wa_conversations')
    .select('id,phone_e164,display_name,bot_paused')
    .eq('id', conversationId)
    .single()
  if (conv.error || !conv.data) return { ok: false, error: 'Conversación no encontrada' }

  // Nombre del contacto para {{1}}: el del lead si lo capturó el bot, si no el
  // display_name de WhatsApp.
  const { data: lead } = await admin
    .from('wa_leads')
    .select('contact_name')
    .eq('conversation_id', conversationId)
    .maybeSingle()
  const contactName =
    (lead as { contact_name?: string | null } | null)?.contact_name ||
    (conv.data.display_name as string | null) ||
    'buen día'

  // Igual que sendStaffReply: si un humano retoma, el bot no habla encima.
  if (!conv.data.bot_paused) {
    await admin
      .from('wa_conversations')
      .update({ bot_paused: true, paused_by: guard.userId, paused_at: new Date().toISOString() })
      .eq('id', conversationId)
  }

  const send = await sendWhatsappTemplate({
    toE164: conv.data.phone_e164 as string,
    templateKey: 'LEAD_FOLLOWUP',
    params: { contact_name: contactName, topic: tema },
  })

  const now = new Date().toISOString()
  const bodyLog = `[seguimiento comercial] ${contactName} — ${tema}`

  if (!send.ok) {
    await admin.from('wa_messages').insert({
      conversation_id: conversationId,
      direction: 'outbound',
      msg_type: 'template',
      body: bodyLog,
      sent_by: 'staff',
      staff_user_id: guard.userId,
      wa_status: 'failed',
      wa_error_json: send.raw,
      created_at: now,
    })
    return { ok: false, error: `Meta API: ${send.errorText ?? 'falló el envío'}` }
  }

  const insert = await admin
    .from('wa_messages')
    .insert({
      conversation_id: conversationId,
      direction: 'outbound',
      wamid: send.wamid,
      msg_type: 'template',
      body: bodyLog,
      sent_by: 'staff',
      staff_user_id: guard.userId,
      wa_status: 'sent',
      raw_json: send.raw,
      created_at: now,
    })
    .select('id')
    .single()
  if (insert.error || !insert.data) {
    return { ok: false, error: insert.error?.message ?? 'No se pudo registrar el mensaje' }
  }

  await admin
    .from('wa_conversations')
    .update({
      last_message_at: now,
      last_message_preview: '📨 Seguimiento comercial',
      unread_count: 0,
      needs_attention: false,
      attention_reason: null,
      attention_at: null,
    })
    .eq('id', conversationId)

  revalidatePath(`/whatsapp/${conversationId}`)
  revalidatePath('/whatsapp')
  return { ok: true, messageId: insert.data.id }
}

// ────────────────────────────────────────────────────────────
// Marcar conversación como leída
// ────────────────────────────────────────────────────────────
export async function markConversationRead(conversationId: string): Promise<Result> {
  const guard = await requireAgencyUser()
  if (!guard.ok) return guard
  const admin = createAdminClient()
  const { error } = await admin
    .from('wa_conversations')
    // Abrir/leer la conversación cuenta como atender el handoff.
    .update({ unread_count: 0, needs_attention: false, attention_reason: null, attention_at: null })
    .eq('id', conversationId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/whatsapp')
  return { ok: true }
}

// ────────────────────────────────────────────────────────────
// Quitar el vínculo cliente ↔ conversación (vuelve a ser lead)
// ────────────────────────────────────────────────────────────
export async function unlinkConversationFromClient(args: {
  conversationId: string
  /** Si true, también borra la fila de client_whatsapp_contacts para que
   *  futuros mensajes desde el mismo número NO se auto-vinculen al cliente
   *  anterior. Default true. */
  removeContact?: boolean
}): Promise<Result> {
  const guard = await requireAgencyUser()
  if (!guard.ok) return guard

  const admin = createAdminClient()
  const conv = await admin
    .from('wa_conversations')
    .select('id, phone_e164, client_id, contact_id')
    .eq('id', args.conversationId)
    .single()
  if (conv.error || !conv.data) return { ok: false, error: 'Conversación no encontrada' }

  // Multi-marca: quita SOLO el vínculo con la marca ACTIVA (no borra los
  // contactos de las OTRAS marcas del mismo número).
  if (args.removeContact !== false && conv.data.client_id) {
    await admin
      .from('client_whatsapp_contacts')
      .delete()
      .eq('phone_e164', conv.data.phone_e164)
      .eq('client_id', conv.data.client_id)
  }

  const upd = await admin
    .from('wa_conversations')
    .update({ client_id: null, contact_id: null })
    .eq('id', args.conversationId)
  if (upd.error) return { ok: false, error: upd.error.message }

  revalidatePath(`/whatsapp/${args.conversationId}`)
  return { ok: true }
}

// ────────────────────────────────────────────────────────────
// Fijar la marca ACTIVA de una conversación (multi-marca) desde el inbox.
// La marca debe estar vinculada al número (client_whatsapp_contacts).
// ────────────────────────────────────────────────────────────
export async function setActiveBrandForConversation(args: {
  conversationId: string
  clientId: string
}): Promise<Result> {
  const guard = await requireAgencyUser()
  if (!guard.ok) return guard

  const admin = createAdminClient()
  const conv = await admin
    .from('wa_conversations')
    .select('id, phone_e164')
    .eq('id', args.conversationId)
    .single()
  if (conv.error || !conv.data) return { ok: false, error: 'Conversación no encontrada' }

  const contact = await admin
    .from('client_whatsapp_contacts')
    .select('id')
    .eq('phone_e164', conv.data.phone_e164)
    .eq('client_id', args.clientId)
    .maybeSingle()
  if (!contact.data) return { ok: false, error: 'Esa marca no está vinculada a este número.' }

  const upd = await admin
    .from('wa_conversations')
    .update({ client_id: args.clientId, contact_id: contact.data.id })
    .eq('id', args.conversationId)
  if (upd.error) return { ok: false, error: upd.error.message }

  revalidatePath(`/whatsapp/${args.conversationId}`)
  return { ok: true }
}

// ────────────────────────────────────────────────────────────
// Vincular conversación a cliente manualmente (o REASIGNAR si ya está vinculada)
// ────────────────────────────────────────────────────────────
export async function linkConversationToClient(args: {
  conversationId: string
  clientId: string
  saveAsContact?: boolean
  displayName?: string | null
}): Promise<Result> {
  const guard = await requireAgencyUser()
  if (!guard.ok) return guard

  const admin = createAdminClient()
  const conv = await admin
    .from('wa_conversations')
    .select('id,phone_e164,client_id')
    .eq('id', args.conversationId)
    .single()
  if (conv.error || !conv.data) return { ok: false, error: 'Conversación no encontrada' }

  let contactId: string | null = null
  if (args.saveAsContact) {
    // Multi-marca: el vínculo es ADITIVO. Buscamos el contacto de ESTE número
    // para ESTA marca (acotado por client_id para no romper con varias marcas ni
    // reasignar el contacto de otra marca). Si no existe, se agrega uno nuevo.
    const existing = await admin
      .from('client_whatsapp_contacts')
      .select('id')
      .eq('phone_e164', conv.data.phone_e164)
      .eq('client_id', args.clientId)
      .maybeSingle()
    if (existing.data) {
      contactId = existing.data.id
      await admin
        .from('client_whatsapp_contacts')
        .update({ display_name: args.displayName ?? null })
        .eq('id', existing.data.id)
    } else {
      const ins = await admin
        .from('client_whatsapp_contacts')
        .insert({
          client_id: args.clientId,
          phone_e164: conv.data.phone_e164,
          display_name: args.displayName ?? null,
        })
        .select('id')
        .single()
      contactId = ins.data?.id ?? null
    }
  }

  // Fijar esta marca como la ACTIVA de la conversación.
  const upd = await admin
    .from('wa_conversations')
    .update({ client_id: args.clientId, contact_id: contactId })
    .eq('id', args.conversationId)
  if (upd.error) return { ok: false, error: upd.error.message }

  revalidatePath(`/whatsapp/${args.conversationId}`)
  return { ok: true }
}

// ────────────────────────────────────────────────────────────
// Editar configuración del bot
// ────────────────────────────────────────────────────────────
export interface UpdateBotConfigInput {
  audience: WaBotAudience
  systemPrompt: string
  model: string
  temperature: number
  maxTokens: number
  enabledTools: WaBotTool[]
  debounceSeconds: number
  historyWindow: number
}

export async function updateBotConfig(input: UpdateBotConfigInput): Promise<Result> {
  const guard = await requireAdmin()
  if (!guard.ok) return guard

  if (!['client', 'lead'].includes(input.audience)) {
    return { ok: false, error: 'audience inválida' }
  }
  if (input.systemPrompt.trim().length < 20) {
    return { ok: false, error: 'El system prompt es demasiado corto' }
  }
  if (input.temperature < 0 || input.temperature > 2) {
    return { ok: false, error: 'Temperature fuera de rango (0–2)' }
  }
  if (input.maxTokens < 64 || input.maxTokens > 8192) {
    return { ok: false, error: 'max_tokens fuera de rango (64–8192)' }
  }
  if (input.debounceSeconds < 0 || input.debounceSeconds > 60) {
    return { ok: false, error: 'debounce_seconds fuera de rango (0–60)' }
  }
  if (input.historyWindow < 0 || input.historyWindow > 100) {
    return { ok: false, error: 'history_window fuera de rango (0–100)' }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('wa_bot_configs')
    .update({
      system_prompt: input.systemPrompt,
      model: input.model,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      enabled_tools: input.enabledTools,
      debounce_seconds: input.debounceSeconds,
      history_window: input.historyWindow,
      updated_by: guard.userId,
    })
    .eq('audience', input.audience)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/admin/whatsapp')
  return { ok: true }
}

// ────────────────────────────────────────────────────────────
// Crear contacto explícito asociado a un cliente
// ────────────────────────────────────────────────────────────
export async function addClientWhatsappContact(args: {
  clientId: string
  phone: string
  displayName?: string | null
  isPrimary?: boolean
}): Promise<Result<{ contactId: string }>> {
  const guard = await requireAgencyUser()
  if (!guard.ok) return guard

  const phone = toE164(args.phone)
  if (phone.replace(/\D/g, '').length < 7) {
    return { ok: false, error: 'Número inválido' }
  }

  const admin = createAdminClient()
  const ins = await admin
    .from('client_whatsapp_contacts')
    .insert({
      client_id: args.clientId,
      phone_e164: phone,
      display_name: args.displayName ?? null,
      is_primary: args.isPrimary ?? false,
    })
    .select('id')
    .single()

  if (ins.error || !ins.data) return { ok: false, error: ins.error?.message ?? 'No se pudo crear el contacto' }

  // Si ya hay una conversación con ese número, vincularla retroactivamente.
  await admin
    .from('wa_conversations')
    .update({ client_id: args.clientId, contact_id: ins.data.id })
    .eq('phone_e164', phone)
    .is('client_id', null)

  revalidatePath(`/clients/${args.clientId}`)
  return { ok: true, contactId: ins.data.id }
}
