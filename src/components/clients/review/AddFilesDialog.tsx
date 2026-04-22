'use client'

import { useRef, useState } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { UploadCloudIcon, XIcon } from 'lucide-react'
import type { ReviewAsset, ReviewVersion } from '@/types/db'
import {
  createReviewAsset,
  createReviewVersion,
} from '@/app/actions/content-review'
import {
  REVIEW_ALLOWED_TYPES,
  REVIEW_MAX_BYTES,
  captureVideoThumbnail,
  kindForMime,
  uploadReviewFile,
  uploadReviewThumbnail,
} from '@/lib/supabase/upload-review-file'

type Mode = { kind: 'new-asset' } | { kind: 'new-version'; assetId: string }

interface AddFilesDialogProps {
  open: boolean
  onClose: () => void
  mode: Mode
  requirementId: string
  clientId: string
  onUploaded: (r: { asset: ReviewAsset | null; version: ReviewVersion }) => void
}

export function AddFilesDialog({
  open,
  onClose,
  mode,
  requirementId,
  clientId,
  onUploaded,
}: AddFilesDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  function reset() {
    setFile(null)
    setName('')
    setError(null)
    setBusy(false)
  }

  function handleClose() {
    if (busy) return
    reset()
    onClose()
  }

  function handleSelect(f: File) {
    setError(null)
    const kind = kindForMime(f.type)
    if (!kind) {
      setError('Formato no permitido. Usa JPG, PNG, WebP, GIF, MP4, WebM o MOV.')
      return
    }
    if (f.size > REVIEW_MAX_BYTES) {
      setError('El archivo supera el límite de 200 MB.')
      return
    }
    setFile(f)
    if (!name) {
      const base = f.name.replace(/\.[^.]+$/, '')
      setName(base)
    }
  }

  async function handleUpload() {
    if (!file) return
    const kind = kindForMime(file.type)
    if (!kind) return
    setBusy(true)
    setError(null)

    try {
      let asset: ReviewAsset | null = null
      let assetId: string

      if (mode.kind === 'new-asset') {
        const displayName = name.trim() || file.name
        const createRes = await createReviewAsset({
          requirementId,
          clientId,
          name: displayName,
          kind,
        })
        if (!('ok' in createRes)) {
          setError(createRes.error)
          setBusy(false)
          return
        }
        asset = createRes.data
        assetId = asset.id
      } else {
        assetId = mode.assetId
      }

      // Para new-version, el número real lo calcula el server action.
      // Pero el path de storage necesita un número. Usamos un timestamp
      // temporal en el path NO — usamos el número calculado.
      // Solución: primero creamos la versión con un placeholder de storage,
      // pero ya subimos el archivo con el número real. Para evitar ese
      // roundtrip, subimos con un sufijo basado en created_at y luego
      // la fila referencia ese path real.
      const tempVersion = Date.now()
      const uploaded = await uploadReviewFile({
        file,
        requirementId,
        assetId,
        versionNumber: tempVersion,
      })

      let thumbnailPath: string | null = null
      let durationMs: number | null = null
      if (kind === 'video') {
        const thumb = await captureVideoThumbnail(file)
        if (thumb) {
          durationMs = thumb.durationMs
          thumbnailPath = await uploadReviewThumbnail({
            blob: thumb.blob,
            requirementId,
            assetId,
            versionNumber: tempVersion,
          })
        }
      }

      const versionRes = await createReviewVersion({
        assetId,
        clientId,
        storagePath: uploaded.storagePath,
        mimeType: uploaded.mimeType,
        byteSize: uploaded.byteSize,
        durationMs,
        thumbnailPath,
      })

      if (!('ok' in versionRes)) {
        setError(versionRes.error)
        setBusy(false)
        return
      }

      onUploaded({ asset, version: versionRes.data })
      reset()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al subir el archivo.')
      setBusy(false)
    }
  }

  const title =
    mode.kind === 'new-asset' ? 'Agregar archivo' : 'Subir nueva versión'
  const acceptAttr = REVIEW_ALLOWED_TYPES.join(',')

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(n) => {
        if (!n) handleClose()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[60] bg-black/40" />
        <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-[60] -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-md bg-white rounded-xl shadow-2xl ring-1 ring-black/10 p-5 outline-none">
          <div className="flex items-center justify-between mb-3">
            <DialogPrimitive.Title className="text-base font-semibold text-[#2a2a2a]">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="text-[#595c5e] hover:text-[#2a2a2a] rounded-md p-1 hover:bg-[#f5f7f9]"
              aria-label="Cerrar"
            >
              <XIcon className="w-5 h-5" />
            </DialogPrimitive.Close>
          </div>

          {mode.kind === 'new-asset' && (
            <div className="mb-3">
              <label className="block text-xs font-semibold text-[#2a2a2a] mb-1">
                Nombre del archivo
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Reel 2 a 6 días JS"
                disabled={busy}
                className="w-full text-sm border border-[#dfe3e6] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#00675c]/30"
              />
            </div>
          )}

          <div
            onClick={() => !busy && inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (busy) return
              const f = e.dataTransfer.files?.[0]
              if (f) handleSelect(f)
            }}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              busy
                ? 'border-[#dfe3e6] bg-[#f5f7f9] opacity-60'
                : file
                ? 'border-[#00675c] bg-[#00675c]/5'
                : 'border-[#dfe3e6] hover:border-[#00675c]/50 hover:bg-[#f5f7f9]'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept={acceptAttr}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleSelect(f)
              }}
              className="hidden"
              disabled={busy}
            />
            <UploadCloudIcon className="w-8 h-8 text-[#00675c] mx-auto mb-2" />
            {file ? (
              <>
                <p className="text-sm font-semibold text-[#2a2a2a] truncate">
                  {file.name}
                </p>
                <p className="text-xs text-[#595c5e] mt-0.5">
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-[#2a2a2a]">
                  Arrastra un archivo o haz clic
                </p>
                <p className="text-xs text-[#595c5e] mt-0.5">
                  JPG, PNG, WebP, GIF, MP4, WebM, MOV · hasta 200 MB
                </p>
              </>
            )}
          </div>

          {error && (
            <div className="mt-3 text-xs text-[#b31b25] bg-[#b31b25]/10 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={handleClose}
              disabled={busy}
              className="px-4 py-2 rounded-full text-xs font-semibold text-[#595c5e] hover:bg-[#f5f7f9] disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              onClick={handleUpload}
              disabled={!file || busy || (mode.kind === 'new-asset' && !name.trim())}
              className="px-4 py-2 rounded-full text-xs font-semibold bg-[#00675c] text-white hover:bg-[#004d45] disabled:opacity-40 transition-colors"
            >
              {busy ? 'Subiendo…' : 'Subir'}
            </button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
