'use client'

import { UploadCloudIcon } from 'lucide-react'
import type { ReviewAsset, ReviewPin, ReviewVersion, ReviewComment } from '@/types/db'
import { ImageViewer } from './ImageViewer'
import { VideoViewer } from './VideoViewer'

interface UserMini {
  id: string
  full_name: string
  avatar_url: string | null
  role: string
}

interface ReviewCenterViewerProps {
  loading: boolean
  error: string | null
  asset: ReviewAsset | null
  version: ReviewVersion | null
  pins: ReviewPin[]
  selectedPinId: string | null
  onSelectPin: (id: string | null) => void
  clientId: string
  users: UserMini[]
  onPinCreated: (pin: ReviewPin, comment: ReviewComment) => void
  onEmptyAddFiles: () => void
}

export function ReviewCenterViewer({
  loading,
  error,
  asset,
  version,
  pins,
  selectedPinId,
  onSelectPin,
  clientId,
  users,
  onPinCreated,
  onEmptyAddFiles,
}: ReviewCenterViewerProps) {
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#8a8f93] text-sm">
        Cargando…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="max-w-sm text-center text-sm text-[#b31b25]">{error}</div>
      </div>
    )
  }

  if (!asset || !version) {
    return (
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-[#00675c]/10 flex items-center justify-center mx-auto mb-3">
            <UploadCloudIcon className="w-7 h-7 text-[#00675c]" />
          </div>
          <h3 className="text-sm font-semibold text-[#2a2a2a] mb-1">
            Sin archivos para revisar
          </h3>
          <p className="text-xs text-[#595c5e] mb-4">
            Sube imágenes o videos para empezar a recibir feedback con pines.
          </p>
          <button
            onClick={onEmptyAddFiles}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#00675c] text-white text-xs font-semibold hover:bg-[#004d45] transition-colors"
          >
            Agregar archivos
          </button>
        </div>
      </div>
    )
  }

  if (asset.kind === 'video') {
    return (
      <VideoViewer
        asset={asset}
        version={version}
        pins={pins}
        selectedPinId={selectedPinId}
        onSelectPin={onSelectPin}
        clientId={clientId}
        users={users}
        onPinCreated={onPinCreated}
      />
    )
  }

  return (
    <ImageViewer
      asset={asset}
      version={version}
      pins={pins}
      selectedPinId={selectedPinId}
      onSelectPin={onSelectPin}
      clientId={clientId}
      users={users}
      onPinCreated={onPinCreated}
    />
  )
}
