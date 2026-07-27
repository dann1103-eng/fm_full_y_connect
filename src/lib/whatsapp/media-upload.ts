import { GRAPH_API_BASE, getWhatsappEnv } from './env'

/**
 * Sube un binario a Meta y devuelve el `media_id` (vive ~30 días).
 * Sirve para adjuntar documentos tanto en mensajes libres como en plantillas.
 *
 * Es lo INVERSO de `media.ts`, que descarga media entrante de Meta a Storage.
 *
 * ⚠️ Este `media_id` NO es el `header_handle` que pide la CREACIÓN de una
 * plantilla con encabezado de documento (ese sale de la Resumable Upload API,
 * `/{app_id}/uploads`). Son identificadores distintos y no son intercambiables:
 * las plantillas se aprueban a mano en Business Manager.
 */
export async function uploadWhatsappMedia(args: {
  buffer: Buffer
  filename: string
  mimeType: string
}): Promise<{ ok: boolean; mediaId: string | null; errorText?: string }> {
  const { token, phoneNumberId } = getWhatsappEnv()

  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', args.mimeType)
  form.append(
    'file',
    new Blob([new Uint8Array(args.buffer)], { type: args.mimeType }),
    args.filename,
  )

  // Sin Content-Type manual: fetch calcula el boundary del multipart.
  const res = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })

  const raw = (await res.json().catch(() => ({}))) as { id?: string }
  if (!res.ok || !raw.id) {
    return { ok: false, mediaId: null, errorText: JSON.stringify(raw) }
  }
  return { ok: true, mediaId: raw.id }
}
