import { createClient } from './client'

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB

export async function uploadClientLogo(file: File, clientId: string): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Formato no permitido. Usa PNG, JPG, WebP o SVG.')
  }
  if (file.size > MAX_BYTES) {
    throw new Error('El archivo supera el límite de 2 MB.')
  }

  const ext = file.name.split('.').pop() ?? 'png'
  const path = `${clientId}/${Date.now()}.${ext}`

  const supabase = createClient()
  const { error } = await supabase.storage
    .from('client-logos')
    .upload(path, file, { upsert: false })

  if (error) throw new Error(`Error al subir el logo: ${error.message}`)

  const { data } = supabase.storage.from('client-logos').getPublicUrl(path)
  return data.publicUrl
}
