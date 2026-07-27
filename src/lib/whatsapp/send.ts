import { GRAPH_API_BASE, getWhatsappEnv } from './env'

export interface SendResult {
  wamid: string | null
  raw: Record<string, unknown>
  ok: boolean
  errorText?: string
}

/**
 * Envía un mensaje de texto vía Cloud API.
 * `toE164` debe ser el número en E.164 con `+` (se quita aquí porque Meta lo prefiere sin +).
 */
export async function sendWhatsappText(args: { toE164: string; body: string; previewUrl?: boolean }): Promise<SendResult> {
  const { token, phoneNumberId } = getWhatsappEnv()
  const to = args.toE164.replace(/^\+/, '')

  const res = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: args.previewUrl ?? false, body: args.body },
    }),
  })

  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    return { wamid: null, raw, ok: false, errorText: JSON.stringify(raw) }
  }

  const wamid = extractWamid(raw)
  return { wamid, raw, ok: true }
}

/**
 * Envía un documento (PDF, etc.) ya subido a Meta con `uploadWhatsappMedia`.
 * Solo válido DENTRO de la ventana de 24h; fuera de ella hay que usar una
 * plantilla con encabezado de documento (ver `templates.ts`).
 */
export async function sendWhatsappDocument(args: {
  toE164: string
  mediaId: string
  filename: string
  caption?: string
}): Promise<SendResult> {
  const { token, phoneNumberId } = getWhatsappEnv()
  const to = args.toE164.replace(/^\+/, '')

  const res = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'document',
      document: {
        id: args.mediaId,
        filename: args.filename,
        ...(args.caption ? { caption: args.caption } : {}),
      },
    }),
  })

  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    return { wamid: null, raw, ok: false, errorText: JSON.stringify(raw) }
  }
  return { wamid: extractWamid(raw), raw, ok: true }
}

/**
 * Envía un mensaje basado en una plantilla aprobada (Fase 2 — fuera de ventana 24h).
 */
export async function sendWhatsappTemplate(args: {
  toE164: string
  templateName: string
  languageCode?: string
  components?: unknown[]
}): Promise<SendResult> {
  const { token, phoneNumberId } = getWhatsappEnv()
  const to = args.toE164.replace(/^\+/, '')

  const res = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: args.templateName,
        language: { code: args.languageCode ?? 'es' },
        components: args.components ?? [],
      },
    }),
  })

  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    return { wamid: null, raw, ok: false, errorText: JSON.stringify(raw) }
  }
  return { wamid: extractWamid(raw), raw, ok: true }
}

function extractWamid(raw: Record<string, unknown>): string | null {
  const messages = raw['messages']
  if (Array.isArray(messages) && messages[0] && typeof messages[0] === 'object') {
    const id = (messages[0] as { id?: string }).id
    return id ?? null
  }
  return null
}
