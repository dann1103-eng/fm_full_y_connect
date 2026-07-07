/**
 * Webhook de WhatsApp Cloud API.
 *
 *  - GET  → verificación inicial de Meta (hub.mode=subscribe + hub.verify_token).
 *  - POST → recepción de mensajes y status updates.
 *
 * Configurar en Meta for Developers → FM Bot → WhatsApp → Configuração da produção:
 *   URL de callback: https://fullefm.site/api/whatsapp/webhook
 *   Verificar token: el valor de WHATSAPP_VERIFY_TOKEN en Vercel
 *
 * Seguridad:
 *   - GET responde 200+challenge solo si verify_token matchea.
 *   - POST valida la firma X-Hub-Signature-256 contra WHATSAPP_APP_SECRET.
 *   - Body persistido (raw_json) para auditoría aún si parsing parcial falla.
 *
 * Performance:
 *   - Devolvemos 200 lo antes posible. Tareas pesadas (descarga de media,
 *     dedupe de jobs) se hacen secuencialmente pero sin esperar al worker IA.
 */

import { NextResponse } from 'next/server'
import { createWaAdminClient as createAdminClient } from '@/lib/whatsapp/db'
import { getWhatsappEnv } from '@/lib/whatsapp/env'
import { verifyMetaSignature } from '@/lib/whatsapp/verify'
import {
  parseWebhookPayload,
  toE164,
  type ParsedInboundMessage,
  type ParsedStatusUpdate,
} from '@/lib/whatsapp/normalize'
import { downloadMediaToStorage } from '@/lib/whatsapp/media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FM_BOT_USER_ID = '00000000-0000-0000-0000-000000000b07'

// ──────────────────────────────────────────────────────────────
// GET — verificación inicial
// ──────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge') ?? ''

  // El GET de verificación SOLO necesita VERIFY_TOKEN, no el resto de env vars
  // (token, app_secret, phone_number_id se usan únicamente para POST).
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN
  if (!verifyToken) {
    console.error('[whatsapp/webhook] WHATSAPP_VERIFY_TOKEN no configurado en este entorno')
    return new NextResponse('verify_token_not_configured', { status: 503 })
  }

  if (mode === 'subscribe' && token === verifyToken) {
    return new NextResponse(challenge, { status: 200 })
  }
  console.warn('[whatsapp/webhook] verify mismatch', {
    mode,
    received_len: token?.length ?? 0,
    expected_len: verifyToken.length,
  })
  return new NextResponse('forbidden', { status: 403 })
}

// ──────────────────────────────────────────────────────────────
// POST — eventos
// ──────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  let env
  try {
    env = getWhatsappEnv()
  } catch (err) {
    console.error('[whatsapp/webhook] env missing', err)
    return new NextResponse('webhook_not_configured', { status: 503 })
  }

  if (!verifyMetaSignature(rawBody, signature, env.appSecret)) {
    console.warn('[whatsapp/webhook] firma inválida')
    return new NextResponse('invalid_signature', { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new NextResponse('bad_json', { status: 400 })
  }

  const parsed = parseWebhookPayload(payload)
  const supabase = createAdminClient()

  // Procesamos en serie para mantener idempotencia simple. Volúmenes pequeños.
  for (const msg of parsed.messages) {
    try {
      await handleInbound(supabase, msg)
    } catch (err) {
      console.error('[whatsapp/webhook] error en inbound', msg.wamid, err)
    }
  }
  for (const st of parsed.statuses) {
    try {
      await handleStatus(supabase, st)
    } catch (err) {
      console.error('[whatsapp/webhook] error en status', st.wamid, err)
    }
  }

  return NextResponse.json({ ok: true })
}

// ──────────────────────────────────────────────────────────────
// Procesamiento de mensajes entrantes
// ──────────────────────────────────────────────────────────────
type AdminClient = ReturnType<typeof createAdminClient>

async function handleInbound(supabase: AdminClient, msg: ParsedInboundMessage) {
  // 1) Idempotencia: si ya existe el wamid no reprocesamos.
  const existing = await supabase
    .from('wa_messages')
    .select('id')
    .eq('wamid', msg.wamid)
    .maybeSingle()
  if (existing.data) return

  // 2) Upsert de conversación + match a cliente.
  const conversation = await upsertConversation(supabase, msg)

  // 3) Descargar media si aplica (síncrono pero acotado en tamaño por Meta).
  let mediaPath: string | null = null
  if (msg.mediaId) {
    const result = await downloadMediaToStorage({
      mediaId: msg.mediaId,
      conversationId: conversation.id,
      wamid: msg.wamid,
      mimeHint: msg.mediaMime,
    })
    mediaPath = result?.storagePath ?? null
  }

  // 4) Insertar wa_message.
  const insertRes = await supabase
    .from('wa_messages')
    .insert({
      conversation_id: conversation.id,
      direction: 'inbound',
      wamid: msg.wamid,
      msg_type: msg.msgType,
      body: msg.body,
      media_path: mediaPath,
      media_mime: msg.mediaMime,
      raw_json: msg.raw,
      created_at: msg.timestamp,
    })
    .select('id')
    .single()

  if (insertRes.error) {
    console.error('[whatsapp/webhook] insert wa_messages', insertRes.error)
    return
  }

  // 5) Actualizar metadatos de la conversación (último mensaje + unread).
  await supabase
    .from('wa_conversations')
    .update({
      last_inbound_at: msg.timestamp,
      last_message_at: msg.timestamp,
      last_message_preview: msg.body?.slice(0, 140) ?? mediaPreview(msg.msgType),
      unread_count: (conversation.unread_count ?? 0) + 1,
      display_name: conversation.display_name ?? msg.profileName ?? null,
    })
    .eq('id', conversation.id)

  // 6) Encolar job whatsapp_reply (dedupe por índice único parcial).
  await maybeEnqueueReply(supabase, conversation)
}

async function upsertConversation(supabase: AdminClient, msg: ParsedInboundMessage) {
  const phone = msg.fromE164

  // ¿Existe conversación?
  const found = await supabase
    .from('wa_conversations')
    .select('id,client_id,contact_id,bot_paused,unread_count,display_name')
    .eq('phone_e164', phone)
    .maybeSingle()

  if (found.data) return found.data

  // Match a cliente: 1) client_whatsapp_contacts, 2) clients.contact_phone normalizado.
  const matched = await matchClientByPhone(supabase, phone)

  const insertRes = await supabase
    .from('wa_conversations')
    .insert({
      phone_e164: phone,
      client_id: matched?.clientId ?? null,
      contact_id: matched?.contactId ?? null,
      display_name: msg.profileName ?? null,
    })
    .select('id,client_id,contact_id,bot_paused,unread_count,display_name')
    .single()

  if (insertRes.error || !insertRes.data) {
    throw new Error(`upsertConversation failed: ${insertRes.error?.message}`)
  }
  return insertRes.data
}

async function matchClientByPhone(supabase: AdminClient, phoneE164: string) {
  // 1) Tabla dedicada. Un número puede estar vinculado a VARIAS marcas
  //    (multi-marca): si hay exactamente una, esa queda como marca activa; si hay
  //    varias, dejamos la marca activa en null (el bot preguntará de cuál marca) y
  //    la resolución de candidatas se hace en el handler.
  const contacts = await supabase
    .from('client_whatsapp_contacts')
    .select('id,client_id')
    .eq('phone_e164', phoneE164)
  const rows = contacts.data ?? []
  if (rows.length === 1) {
    return { contactId: rows[0].id, clientId: rows[0].client_id }
  }
  if (rows.length > 1) {
    return null // multi-marca: sin marca activa hasta que se elija
  }

  // 2) Match laxo contra clients.contact_phone (normalizado en memoria).
  const digits = phoneE164.replace(/\D/g, '')
  const allClients = await supabase
    .from('clients')
    .select('id,contact_phone')
    .not('contact_phone', 'is', null)
  if (allClients.data) {
    for (const c of allClients.data) {
      if (!c.contact_phone) continue
      const cleaned = toE164(c.contact_phone).replace(/\D/g, '')
      if (cleaned === digits || cleaned.endsWith(digits) || digits.endsWith(cleaned)) {
        return { contactId: null, clientId: c.id }
      }
    }
  }
  return null
}

interface ConversationCtx {
  id: string
  client_id: string | null
  bot_paused: boolean
}

async function maybeEnqueueReply(supabase: AdminClient, conversation: ConversationCtx) {
  // Si la conv está pausada → no encolar.
  if (conversation.bot_paused) return

  // Si tiene cliente vinculado y el cliente tiene bot_enabled=false → no encolar.
  if (conversation.client_id) {
    const c = await supabase
      .from('clients')
      .select('wa_bot_enabled')
      .eq('id', conversation.client_id)
      .maybeSingle()
    if (c.data && c.data.wa_bot_enabled === false) return
  }

  // Leer debounce de la config de la audiencia correspondiente.
  const audience = conversation.client_id ? 'client' : 'lead'
  const cfg = await supabase
    .from('wa_bot_configs')
    .select('debounce_seconds')
    .eq('audience', audience)
    .maybeSingle()
  const debounce = cfg.data?.debounce_seconds ?? 3

  const scheduledFor = new Date(Date.now() + debounce * 1000).toISOString()

  // Dedupe vía índice único parcial: si ya hay pending, ignoramos error 23505.
  const ins = await supabase
    .from('ai_jobs')
    .insert({
      job_type: 'whatsapp_reply',
      status: 'pending',
      priority: 5,
      client_id: conversation.client_id,
      input_json: { conversationId: conversation.id },
      scheduled_for: scheduledFor,
      wa_conversation_id: conversation.id,
    } as never)
    .select('id')
    .maybeSingle()

  if (ins.error && !ins.error.message.includes('duplicate key')) {
    console.error('[whatsapp/webhook] enqueue job error', ins.error)
  }

  // Disparo inmediato del runner: fire-and-forget (no esperamos respuesta para
  // no bloquear el 200 OK que Meta exige rápido). El runner espera hasta
  // `wait` ms a que el job sea elegible (cubre el debounce) y luego procesa.
  triggerJobRunner(debounce * 1000 + 2000).catch((err) =>
    console.warn('[whatsapp/webhook] trigger runner failed', err),
  )
}

async function triggerJobRunner(waitMs: number): Promise<void> {
  const secret = process.env.AI_JOBS_TRIGGER_SECRET
  if (!secret) return
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    'https://www.fullefm.site'
  // No await: dispara y olvida.
  void fetch(`${base}/api/ai-jobs/process?max=3&wait=${waitMs}`, {
    method: 'POST',
    headers: { 'x-trigger-secret': secret, 'content-type': 'application/json' },
    body: '{}',
    cache: 'no-store',
    keepalive: true,
  })
}

// ──────────────────────────────────────────────────────────────
// Procesamiento de status updates (sent/delivered/read/failed)
// ──────────────────────────────────────────────────────────────
async function handleStatus(supabase: AdminClient, st: ParsedStatusUpdate) {
  await supabase
    .from('wa_messages')
    .update({
      wa_status: st.status,
      wa_error_json: st.errors,
    })
    .eq('wamid', st.wamid)
}

function mediaPreview(type: string): string {
  switch (type) {
    case 'image': return '📷 Imagen'
    case 'audio': return '🎤 Audio'
    case 'video': return '🎬 Video'
    case 'document': return '📎 Documento'
    case 'sticker': return '🩹 Sticker'
    case 'location': return '📍 Ubicación'
    default: return ''
  }
}

// El bot user id se exporta por si el handler en el worker lo necesita;
// el webhook no lo usa directamente.
export { FM_BOT_USER_ID }
