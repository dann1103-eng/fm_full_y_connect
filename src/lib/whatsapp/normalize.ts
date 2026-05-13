import type { WaMessageType } from '@/types/db'

/**
 * Normaliza un número de WhatsApp a formato E.164 (`+503...`).
 * Meta envía el "wa_id" sin signo +.
 */
export function toE164(input: string): string {
  const digits = input.replace(/[^\d]/g, '')
  if (!digits) return input
  return digits.startsWith('+') ? digits : `+${digits}`
}

export interface ParsedInboundMessage {
  wamid: string
  fromE164: string
  profileName: string | null
  timestamp: string                  // ISO
  msgType: WaMessageType
  body: string | null                // texto plano o caption
  mediaId: string | null
  mediaMime: string | null
  raw: Record<string, unknown>
}

export interface ParsedStatusUpdate {
  wamid: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  recipientE164: string
  errors: Record<string, unknown> | null
  raw: Record<string, unknown>
}

export interface ParsedWebhook {
  messages: ParsedInboundMessage[]
  statuses: ParsedStatusUpdate[]
}

/**
 * Aplana el payload de Meta (`entry[].changes[].value`) a una lista de mensajes
 * y status updates normalizados. Soporta múltiples entries por POST.
 */
export function parseWebhookPayload(payload: unknown): ParsedWebhook {
  const messages: ParsedInboundMessage[] = []
  const statuses: ParsedStatusUpdate[] = []

  const obj = payload as { entry?: Array<{ changes?: Array<{ value?: WaValue }> }> } | null
  if (!obj?.entry) return { messages, statuses }

  for (const entry of obj.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      if (!value) continue

      // Map wa_id → profile name desde contacts[].
      const profileByWaId: Record<string, string> = {}
      for (const c of value.contacts ?? []) {
        if (c.wa_id) profileByWaId[c.wa_id] = c.profile?.name ?? ''
      }

      for (const m of value.messages ?? []) {
        const msgType = (m.type as WaMessageType) ?? 'text'
        let body: string | null = null
        let mediaId: string | null = null
        let mediaMime: string | null = null

        switch (msgType) {
          case 'text':
            body = m.text?.body ?? null
            break
          case 'image':
            body = m.image?.caption ?? null
            mediaId = m.image?.id ?? null
            mediaMime = m.image?.mime_type ?? null
            break
          case 'audio':
            mediaId = m.audio?.id ?? null
            mediaMime = m.audio?.mime_type ?? null
            break
          case 'video':
            body = m.video?.caption ?? null
            mediaId = m.video?.id ?? null
            mediaMime = m.video?.mime_type ?? null
            break
          case 'document':
            body = m.document?.caption ?? m.document?.filename ?? null
            mediaId = m.document?.id ?? null
            mediaMime = m.document?.mime_type ?? null
            break
          case 'sticker':
            mediaId = m.sticker?.id ?? null
            mediaMime = m.sticker?.mime_type ?? null
            break
          case 'location':
            body = m.location ? `📍 ${m.location.latitude},${m.location.longitude}` : null
            break
          case 'interactive':
            body =
              m.interactive?.button_reply?.title ??
              m.interactive?.list_reply?.title ??
              null
            break
          default:
            body = null
        }

        messages.push({
          wamid: m.id,
          fromE164: toE164(m.from),
          profileName: profileByWaId[m.from] || null,
          timestamp: new Date(Number(m.timestamp) * 1000).toISOString(),
          msgType,
          body,
          mediaId,
          mediaMime,
          raw: m as unknown as Record<string, unknown>,
        })
      }

      for (const s of value.statuses ?? []) {
        statuses.push({
          wamid: s.id,
          status: (s.status as ParsedStatusUpdate['status']) ?? 'sent',
          recipientE164: toE164(s.recipient_id ?? ''),
          errors: s.errors ? (s.errors as unknown as Record<string, unknown>) : null,
          raw: s as unknown as Record<string, unknown>,
        })
      }
    }
  }

  return { messages, statuses }
}

// ── Shapes mínimos del payload de Meta — no exhaustivos. ─────
interface WaValue {
  messaging_product?: string
  metadata?: { display_phone_number?: string; phone_number_id?: string }
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>
  messages?: WaInboundRaw[]
  statuses?: WaStatusRaw[]
}

interface WaInboundRaw {
  from: string
  id: string
  timestamp: string
  type: string
  text?: { body?: string }
  image?: { id?: string; mime_type?: string; caption?: string }
  audio?: { id?: string; mime_type?: string }
  video?: { id?: string; mime_type?: string; caption?: string }
  document?: { id?: string; mime_type?: string; caption?: string; filename?: string }
  sticker?: { id?: string; mime_type?: string }
  location?: { latitude: number; longitude: number }
  interactive?: {
    type?: string
    button_reply?: { id?: string; title?: string }
    list_reply?: { id?: string; title?: string }
  }
}

interface WaStatusRaw {
  id: string
  status: string
  recipient_id?: string
  errors?: unknown
}
