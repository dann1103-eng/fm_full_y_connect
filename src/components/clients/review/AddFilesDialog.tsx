'use client'

import { useRef, useState } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { UploadCloudIcon, XIcon, Trash2Icon } from 'lucide-react'
import type { ReviewAsset, ReviewVersion, ReviewVersionFile } from '@/types/db'
import {
  createReviewAsset,
  createReviewVersionWithFiles,
  type ReviewVersionFileInput,
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
  onUploaded: (r: {
    asset: ReviewAsset | null
    version: ReviewVersion
    files: ReviewVersionFile[]
  }) => void
}

export function AddFilesDialog({
  open,
  onClose,
  mode,
  requirementId,
  clientId,
  onUploaded,
}: AddFilesDialogProps) {
  const [files, setFiles] = useState<File[]>([])
  const [name, setName] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  function reset() {
    setFiles([])
    setName('')
    setError(null)
    setBusy(false)
  }

  function handleClose() {
    if (busy) return
    reset()
    onClose()
  }

  function addCandidates(candidates: File[]) {
    setError(null)
    const accepted: File[] = []
    for (const f of candidates) {
      const k = kindForMime(f.type)
      if (!k) {
        setError('Formato no permitido. Usa JPG, PNG, WebP, GIF, MP4, WebM o MOV.')
        continue
      }
      if (f.size > REVIEW_MAX_BYTES) {
        setError('Un archivo supera el límite de 200 MB.')
        continue
      }
      accepted.push(f)
    }
    if (accepted.length === 0) return
    setFiles((prev) => {
      const next = [...prev, ...accepted]
      if (!name && next.length > 0) {
        const base = next[0].name.replace(/\.[^.]+$/, '')
        setName(base)
      }
      return next
    })
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleUpload() {
    if (files.length === 0) return
    setBusy(true)
    setError(null)

    try {
      let asset: ReviewAsset | null = null
      let assetId: string
      const firstKind = kindForMime(files[0].type)
      if (!firstKind) {
        setError('Formato no permitido.')
        setBusy(false)
        return
      }

      if (mode.kind === 'new-asset') {
        const displayName = name.trim() || files[0].name
        const createRes = await createReviewAsset({
          requirementId,
          clientId,
          name: displayName,
          kind: firstKind,
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

      const tempVersion = Date.now()
      const uploadedInputs: ReviewVersionFileInput[] = []
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const kind = kindForMime(f.type)
        if (!kind) continue
        const uploaded = await uploadReviewFile({
          file: f,
          requirementId,
          assetId,
          versionNumber: tempVersion,
          fileIndex: i,
        })
        let thumbnailPath: string | null = null
        let durationMs: number | null = null
        if (kind === 'video') {
          const thumb = await captureVideoThumbnail(f)
          if (thumb) {
            durationMs = thumb.durationMs
            thumbnailPath = await uploadReviewThumbnail({
              blob: thumb.blob,
              requirementId,
              assetId,
              versionNumber: tempVersion,
              fileIndex: i,
            })
          }
        }
        uploadedInputs.push({
          storagePath: uploaded.storagePath,
          mimeType: uploaded.mimeType,
          byteSize: uploaded.byteSize,
          durationMs,
          thumbnailPath,
        })
      }

      const versionRes = await createReviewVersionWithFiles({
        assetId,
        clientId,
        files: uploadedInputs,
      })

      if (!('ok' in versionRes)) {
        setError(versionRes.error)
        setBusy(false)
        return
      }

      onUploaded({
        asset,
        version: versionRes.data.version,
        files: versionRes.data.files,
      })
      reset()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al subir los archivos.')
      setBusy(false)
    }
  }

  const title =
    mode.kind === 'new-asset' ? 'Agregar archivos' : 'Subir nueva versión'
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
        <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-[60] -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-md bg-fm-surface-container-lowest rounded-xl shadow-2xl ring-1 ring-black/10 p-5 outline-none">
          <div className="flex items-center justify-between mb-3">
            <DialogPrimitive.Title className="text-base font-semibold text-fm-on-surface">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="text-fm-on-surface-variant hover:text-fm-on-surface rounded-md p-1 hover:bg-fm-surface-container"
              aria-label="Cerrar"
            >
              <XIcon className="w-5 h-5" />
            </DialogPrimitive.Close>
          </div>

          {mode.kind === 'new-asset' && (
            <div className="mb-3">
              <label className="block text-xs font-semibold text-fm-on-surface mb-1">
                Nombre del archivo
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Carrusel septiembre"
                disabled={busy}
                className="w-full text-sm bg-fm-background text-fm-on-surface border border-fm-surface-container-high rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-fm-primary/30"
              />
            </div>
          )}

          <div
            onClick={() => !busy && inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (busy) return
              const list = Array.from(e.dataTransfer.files ?? [])
              if (list.length > 0) addCandidates(list)
            }}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              busy
                ? 'border-fm-surface-container-high bg-fm-background opacity-60'
                : files.length > 0
                ? 'border-fm-primary bg-fm-primary/5'
                : 'border-fm-surface-container-high hover:border-fm-primary/50 hover:bg-fm-background'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept={acceptAttr}
              multiple
              onChange={(e) => {
                const list = Array.from(e.target.files ?? [])
                if (list.length > 0) addCandidates(list)
                e.currentTarget.value = ''
              }}
              className="hidden"
              disabled={busy}
            />
            <UploadCloudIcon className="w-8 h-8 text-fm-primary mx-auto mb-2" />
            {files.length > 0 ? (
              <>
                <p className="text-sm font-semibold text-fm-on-surface">
                  {files.length} archivo{files.length === 1 ? '' : 's'} seleccionado
                  {files.length === 1 ? '' : 's'}
                </p>
                <p className="text-xs text-fm-on-surface-variant mt-0.5">
                  Haz clic o arrastra para agregar más
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-fm-on-surface">
                  Arrastra archivos o haz clic
                </p>
                <p className="text-xs text-fm-on-surface-variant mt-0.5">
                  JPG, PNG, WebP, GIF, MP4, WebM, MOV · hasta 200 MB c/u
                </p>
              </>
            )}
          </div>

          {files.length > 0 && (
            <ul className="mt-3 max-h-36 overflow-y-auto space-y-1">
              {files.map((f, idx) => (
                <li
                  key={`${f.name}-${idx}`}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-fm-background text-xs"
                >
                  <span className="truncate text-fm-on-surface flex-1">
                    {idx + 1}. {f.name}
                  </span>
                  <span className="text-fm-on-surface-variant tabular-nums">
                    {(f.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    disabled={busy}
                    className="text-fm-error hover:bg-fm-error/10 rounded p-1 disabled:opacity-40"
                    aria-label="Quitar archivo"
                  >
                    <Trash2Icon className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <div className="mt-3 text-xs text-fm-error bg-fm-error/10 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={handleClose}
              disabled={busy}
              className="px-4 py-2 rounded-full text-xs font-semibold text-fm-on-surface-variant hover:bg-fm-background disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              onClick={handleUpload}
              disabled={
                files.length === 0 ||
                busy ||
                (mode.kind === 'new-asset' && !name.trim())
              }
              className="px-4 py-2 rounded-full text-xs font-semibold bg-fm-primary text-white hover:bg-fm-primary-dim disabled:opacity-40 transition-colors"
            >
              {busy ? 'Subiendo…' : 'Subir'}
            </button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
