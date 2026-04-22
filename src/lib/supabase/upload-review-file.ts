import { createClient } from './client'

export const REVIEW_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const

export const REVIEW_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const

export const REVIEW_ALLOWED_TYPES = [
  ...REVIEW_IMAGE_TYPES,
  ...REVIEW_VIDEO_TYPES,
] as const

export const REVIEW_MAX_BYTES = 200 * 1024 * 1024 // 200 MB

export type ReviewUploadKind = 'image' | 'video'

export function kindForMime(mime: string): ReviewUploadKind | null {
  if ((REVIEW_IMAGE_TYPES as readonly string[]).includes(mime)) return 'image'
  if ((REVIEW_VIDEO_TYPES as readonly string[]).includes(mime)) return 'video'
  return null
}

export function extensionForFile(file: File): string {
  const last = file.name.split('.').pop()
  if (last && last.length <= 8) return last.toLowerCase()
  const mimeExt = file.type.split('/')[1]
  return (mimeExt ?? 'bin').toLowerCase()
}

export interface UploadReviewFileParams {
  file: File
  requirementId: string
  assetId: string
  versionNumber: number
}

export interface UploadReviewFileResult {
  storagePath: string
  mimeType: string
  byteSize: number
  kind: ReviewUploadKind
}

/**
 * Sube la versión N de un asset al bucket `review-files`.
 * Path: `{requirement_id}/{asset_id}/v{version_number}.{ext}`.
 * No devuelve URL pública — el bucket es privado; usar signed URLs al leer.
 */
export async function uploadReviewFile({
  file,
  requirementId,
  assetId,
  versionNumber,
}: UploadReviewFileParams): Promise<UploadReviewFileResult> {
  const kind = kindForMime(file.type)
  if (!kind) {
    throw new Error(
      'Formato no permitido. Usa JPG, PNG, WebP, GIF, MP4, WebM o MOV.'
    )
  }
  if (file.size > REVIEW_MAX_BYTES) {
    throw new Error('El archivo supera el límite de 200 MB.')
  }

  const ext = extensionForFile(file)
  const storagePath = `${requirementId}/${assetId}/v${versionNumber}.${ext}`

  const supabase = createClient()
  const { error } = await supabase.storage
    .from('review-files')
    .upload(storagePath, file, { upsert: false, contentType: file.type })

  if (error) {
    throw new Error(`Error al subir el archivo: ${error.message}`)
  }

  return {
    storagePath,
    mimeType: file.type,
    byteSize: file.size,
    kind,
  }
}

/**
 * Sube un thumbnail JPEG para una versión de video.
 * Path convencional: el mismo storagePath del video con sufijo `.thumb.jpg`.
 */
export async function uploadReviewThumbnail(params: {
  blob: Blob
  requirementId: string
  assetId: string
  versionNumber: number
}): Promise<string> {
  const path = `${params.requirementId}/${params.assetId}/v${params.versionNumber}.thumb.jpg`
  const supabase = createClient()
  const { error } = await supabase.storage
    .from('review-files')
    .upload(path, params.blob, { upsert: true, contentType: 'image/jpeg' })
  if (error) throw new Error(`Error al subir la miniatura: ${error.message}`)
  return path
}

/**
 * Captura el primer frame de un video (File) como JPEG Blob.
 * Usa <video> + <canvas>. Devuelve null si el navegador no puede decodificar.
 */
export async function captureVideoThumbnail(file: File): Promise<{
  blob: Blob
  durationMs: number
} | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.src = url

    const cleanup = () => URL.revokeObjectURL(url)

    const fail = () => {
      cleanup()
      resolve(null)
    }

    video.onloadedmetadata = () => {
      // Saltar a un frame temprano pero no el absoluto 0 (algunos codecs lo rinden negro).
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2)
    }

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth || 640
        canvas.height = video.videoHeight || 360
        const ctx = canvas.getContext('2d')
        if (!ctx) return fail()
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(
          (blob) => {
            cleanup()
            if (!blob) return resolve(null)
            resolve({
              blob,
              durationMs: Math.round((video.duration || 0) * 1000),
            })
          },
          'image/jpeg',
          0.82
        )
      } catch {
        fail()
      }
    }

    video.onerror = fail
  })
}
