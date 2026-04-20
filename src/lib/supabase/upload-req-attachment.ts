import { createClient } from './client'

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_OUTPUT_BYTES = 800 * 1024 // 800 KB — presupuesto Supabase: 50MB TOTAL
const MAX_DIMENSION = 1280

export interface UploadedAttachment {
  path: string
  publicUrl: string
  mime: string
  name: string
  sizeBytes: number
}

/**
 * Carga una imagen al bucket `requirement-attachments` con compresión agresiva.
 * - Reescala a máx. 1280px lado mayor
 * - Exporta como JPEG q=0.7 (fallback q=0.55 si sobrepasa 800KB)
 * - Rechaza si sigue > 800KB tras ambas pasadas
 *
 * Por restricción del plan gratuito Supabase (50MB TOTAL entre todos los buckets),
 * el cleanup es indispensable — se hace al archivar ciclo, anular req o borrar cliente.
 */
export async function uploadRequirementAttachment(
  file: File,
  requirementId: string
): Promise<UploadedAttachment> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Formato no permitido. Usa PNG, JPG o WebP.')
  }

  // 1) Cargar imagen en un bitmap
  const bitmap = await loadBitmap(file)

  // 2) Canvas + resize + JPEG q=0.7
  let blob = await renderToJpeg(bitmap, 0.7)

  // 3) Fallback si sobrepasa el presupuesto
  if (blob.size > MAX_OUTPUT_BYTES) {
    blob = await renderToJpeg(bitmap, 0.55)
  }
  if (blob.size > MAX_OUTPUT_BYTES) {
    throw new Error(
      'Imagen demasiado pesada tras compresión. Por favor reduce la imagen antes de subirla.'
    )
  }

  const supabase = createClient()
  const filename = `${crypto.randomUUID()}.jpg`
  const path = `${requirementId}/${filename}`

  const { error } = await supabase.storage
    .from('requirement-attachments')
    .upload(path, blob, {
      upsert: false,
      contentType: 'image/jpeg',
    })

  if (error) throw new Error(`Error al subir la imagen: ${error.message}`)

  const { data } = supabase.storage.from('requirement-attachments').getPublicUrl(path)

  return {
    path,
    publicUrl: data.publicUrl,
    mime: 'image/jpeg',
    name: file.name,
    sizeBytes: blob.size,
  }
}

function loadBitmap(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo cargar la imagen.'))
    }
    img.src = url
  })
}

function renderToJpeg(img: HTMLImageElement, quality: number): Promise<Blob> {
  const { width, height } = img
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
  const targetW = Math.round(width * scale)
  const targetH = Math.round(height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas no disponible.')
  // Fondo blanco por si la imagen tiene transparencia (JPEG no la soporta)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, targetW, targetH)
  ctx.drawImage(img, 0, 0, targetW, targetH)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('Canvas.toBlob devolvió null.'))
        else resolve(blob)
      },
      'image/jpeg',
      quality
    )
  })
}

/**
 * Borra una lista de paths (ya resueltos) del bucket `requirement-attachments`.
 * Llamado en cleanup: al archivar ciclo, anular req, borrar cliente.
 */
export async function deleteRequirementAttachments(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const supabase = createClient()
  await supabase.storage.from('requirement-attachments').remove(paths)
}
