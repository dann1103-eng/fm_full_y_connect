'use client'

import { UploadCloudIcon } from 'lucide-react'
import type {
  ReviewAsset,
  ReviewPin,
  ReviewVersion,
  ReviewVersionFile,
  ReviewComment,
  UserRole,
} from '@/types/db'
import { ImageViewer } from './ImageViewer'
import { VideoViewer } from './VideoViewer'
import { FileThumbnailStrip } from './FileThumbnailStrip'

interface UserMini {
  id: string
  full_name: string
  avatar_url: string | null
  role: UserRole
}

interface ReviewCenterViewerProps {
  loading: boolean
  error: string | null
  asset: ReviewAsset | null
  version: ReviewVersion | null
  files: ReviewVersionFile[]
  selectedFileId: string | null
  onSelectFile: (fileId: string) => void
  pins: ReviewPin[]
  selectedPinId: string | null
  onSelectPin: (id: string | null) => void
  clientId: string
  users: UserMini[]
  commentsByPin: Record<string, ReviewComment[]>
  onPinCreated: (pin: ReviewPin, comment: ReviewComment) => void
  onEmptyAddFiles: () => void
}

export function ReviewCenterViewer({
  loading,
  error,
  asset,
  version,
  files,
  selectedFileId,
  onSelectFile,
  pins,
  selectedPinId,
  onSelectPin,
  clientId,
  users,
  commentsByPin,
  onPinCreated,
  onEmptyAddFiles,
}: ReviewCenterViewerProps) {
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-fm-on-surface-variant text-sm">
        Cargando…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="max-w-sm text-center text-sm text-fm-error">{error}</div>
      </div>
    )
  }

  if (!asset || !version) {
    return (
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-fm-primary/10 flex items-center justify-center mx-auto mb-3">
            <UploadCloudIcon className="w-7 h-7 text-fm-primary" />
          </div>
          <h3 className="text-sm font-semibold text-fm-on-surface mb-1">
            Sin archivos para revisar
          </h3>
          <p className="text-xs text-fm-on-surface-variant mb-4">
            Sube imágenes o videos para empezar a recibir feedback con pines.
          </p>
          <button
            onClick={onEmptyAddFiles}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-fm-primary text-white text-xs font-semibold hover:bg-fm-primary-dim transition-colors"
          >
            Agregar archivos
          </button>
        </div>
      </div>
    )
  }

  const file =
    files.find((f) => f.id === selectedFileId) ?? files[0] ?? null

  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center text-fm-on-surface-variant text-sm">
        Esta versión no tiene archivos.
      </div>
    )
  }

  const filePins = pins.filter((p) => p.file_id === file.id || p.file_id == null)
  const isVideo = file.mime_type.startsWith('video/')

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 flex min-h-0">
        {isVideo ? (
          <VideoViewer
            asset={asset}
            version={version}
            file={file}
            pins={filePins}
            selectedPinId={selectedPinId}
            onSelectPin={onSelectPin}
            clientId={clientId}
            users={users}
            commentsByPin={commentsByPin}
            onPinCreated={onPinCreated}
          />
        ) : (
          <ImageViewer
            asset={asset}
            version={version}
            file={file}
            pins={filePins}
            selectedPinId={selectedPinId}
            onSelectPin={onSelectPin}
            clientId={clientId}
            users={users}
            commentsByPin={commentsByPin}
            onPinCreated={onPinCreated}
          />
        )}
      </div>
      <FileThumbnailStrip
        files={files}
        selectedFileId={file.id}
        onSelect={onSelectFile}
        pins={pins}
      />
    </div>
  )
}
