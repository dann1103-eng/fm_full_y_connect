import { createAdminClient } from '@/lib/supabase/admin'
import { GRAPH_API_BASE, getWhatsappEnv } from './env'

interface DownloadResult {
  storagePath: string
  mime: string | null
  sizeBytes: number
}

/**
 * Descarga un media de WhatsApp y lo persiste en el bucket privado
 * `whatsapp-media` bajo `{conversationId}/{wamid}.{ext}`. Devuelve el path.
 *
 * Meta requiere 2 requests: 1) GET /{mediaId} → URL temporal; 2) GET binario con bearer.
 */
export async function downloadMediaToStorage(args: {
  mediaId: string
  conversationId: string
  wamid: string
  mimeHint?: string | null
}): Promise<DownloadResult | null> {
  const { mediaId, conversationId, wamid, mimeHint } = args
  const { token } = getWhatsappEnv()

  // 1) Obtener URL temporal del media.
  const metaRes = await fetch(`${GRAPH_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!metaRes.ok) {
    console.error('[whatsapp/media] meta lookup failed', mediaId, await metaRes.text())
    return null
  }
  const metaJson = (await metaRes.json()) as { url?: string; mime_type?: string }
  if (!metaJson.url) return null

  // 2) Descargar binario.
  const binRes = await fetch(metaJson.url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!binRes.ok) {
    console.error('[whatsapp/media] binary download failed', mediaId, await binRes.text())
    return null
  }
  const arrayBuf = await binRes.arrayBuffer()
  const buffer = Buffer.from(arrayBuf)

  const mime = mimeHint ?? metaJson.mime_type ?? 'application/octet-stream'
  const ext = guessExtension(mime)
  const storagePath = `${conversationId}/${wamid}.${ext}`

  const supabase = createAdminClient()
  const { error } = await supabase.storage
    .from('whatsapp-media')
    .upload(storagePath, buffer, { contentType: mime, upsert: true })

  if (error) {
    console.error('[whatsapp/media] upload failed', storagePath, error)
    return null
  }

  return { storagePath, mime, sizeBytes: buffer.byteLength }
}

function guessExtension(mime: string): string {
  if (mime.includes('jpeg')) return 'jpg'
  if (mime.includes('png')) return 'png'
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('quicktime')) return 'mov'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('mpeg')) return 'mp3'
  if (mime.includes('amr')) return 'amr'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('pdf')) return 'pdf'
  return 'bin'
}
