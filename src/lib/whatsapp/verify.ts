import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Valida la firma `X-Hub-Signature-256` que Meta envía con cada POST al webhook.
 * El cuerpo se firma con HMAC-SHA256 usando `WHATSAPP_APP_SECRET`.
 */
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false

  const provided = signatureHeader.slice('sha256='.length)
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')

  if (provided.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}
