import { createClient } from './client'

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB

/**
 * Sube el logo de la agencia al bucket "agency-assets" y retorna la URL pública.
 * Usa un path fijo `logo.{ext}` con upsert=true para siempre reemplazar el anterior.
 */
export async function uploadAgencyLogo(file: File): Promise<string> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Formato no permitido. Usa PNG, JPG, WebP o SVG.')
  }
  if (file.size > MAX_BYTES) {
    throw new Error('El archivo supera el límite de 2 MB.')
  }

  const ext = file.type === 'image/svg+xml' ? 'svg' : (file.name.split('.').pop() ?? 'png')
  const path = `logo.${ext}`

  const supabase = createClient()
  const { error } = await supabase.storage
    .from('agency-assets')
    .upload(path, file, { upsert: true })

  if (error) throw new Error(`Error al subir el logo: ${error.message}`)

  const { data } = supabase.storage.from('agency-assets').getPublicUrl(path)
  // Añadir cache-buster para forzar recarga tras reemplazo
  return `${data.publicUrl}?v=${Date.now()}`
}
