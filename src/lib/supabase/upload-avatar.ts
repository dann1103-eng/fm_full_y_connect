import { createClient } from './client'

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB

export async function uploadUserAvatar(file: File, userId: string): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Formato no permitido. Usa PNG, JPG o WebP.')
  }
  if (file.size > MAX_BYTES) {
    throw new Error('El archivo supera el límite de 2 MB.')
  }

  const ext = file.name.split('.').pop() ?? 'jpg'
  const path = `${userId}/avatar.${ext}`

  const supabase = createClient()
  const { error } = await supabase.storage
    .from('user-avatars')
    .upload(path, file, { upsert: true })

  if (error) throw new Error(`Error al subir la foto: ${error.message}`)

  const { data } = supabase.storage.from('user-avatars').getPublicUrl(path)
  return data.publicUrl
}
