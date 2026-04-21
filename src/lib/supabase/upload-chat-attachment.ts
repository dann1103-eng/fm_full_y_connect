import { createClient } from './client'

export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export interface UploadedChatAttachment {
  storage_path: string
  file_name: string
  file_size: number
  mime_type: string
}

export async function uploadChatAttachment(
  file: File,
  conversationId: string
): Promise<UploadedChatAttachment> {
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
    throw new Error('El archivo supera el límite de 10 MB.')
  }

  const supabase = createClient()
  const ext = file.name.includes('.') ? file.name.split('.').pop() : ''
  const safeExt = ext ? `.${ext.toLowerCase().replace(/[^a-z0-9]/g, '')}` : ''
  const tmpId = crypto.randomUUID()
  const storage_path = `${conversationId}/${tmpId}/${tmpId}${safeExt}`

  const { error } = await supabase.storage
    .from('chat-attachments')
    .upload(storage_path, file, {
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    })

  if (error) throw new Error(`Error al subir archivo: ${error.message}`)

  return {
    storage_path,
    file_name: file.name,
    file_size: file.size,
    mime_type: file.type || 'application/octet-stream',
  }
}

export async function signedUrlForChatAttachment(
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const supabase = createClient()
  const { data } = await supabase.storage
    .from('chat-attachments')
    .createSignedUrl(storagePath, expiresInSeconds)
  return data?.signedUrl ?? null
}
