'use client'

import { FileTextIcon, ImageIcon, VideoIcon } from 'lucide-react'
import type { ReviewAsset, ReviewVersion, ReviewPin } from '@/types/db'

interface AssetVersionStripProps {
  assets: ReviewAsset[]
  versionsByAsset: Record<string, ReviewVersion[]>
  pinsByVersion: Record<string, ReviewPin[]>
  selectedVersionId: string | null
  onSelectVersion: (assetId: string, versionId: string) => void
  clientMode?: boolean
}

export function AssetVersionStrip({
  assets,
  versionsByAsset,
  pinsByVersion,
  selectedVersionId,
  onSelectVersion,
}: AssetVersionStripProps) {
  if (assets.length === 0) return null

  return (
    <div className="flex gap-2 px-3 py-2 overflow-x-auto">
      {assets.flatMap((asset) => {
        const versions = versionsByAsset[asset.id] ?? []
        return versions.map((version, idx) => {
          const isSelected = version.id === selectedVersionId
          const pinCount = (pinsByVersion[version.id] ?? []).length
          const label =
            versions.length > 1
              ? `${asset.name.slice(0, 8)} v${idx + 1}`
              : asset.name.slice(0, 12)

          return (
            <button type="button"
              key={version.id}
              onClick={() => onSelectVersion(asset.id, version.id)}
              className={`flex-shrink-0 flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg border-2 transition-colors ${
                isSelected
                  ? 'border-fm-primary bg-fm-primary/10'
                  : 'border-fm-surface-container-high hover:border-fm-primary/40'
              }`}
            >
              <div className="w-9 h-9 rounded bg-fm-surface-container flex items-center justify-center text-fm-on-surface-variant">
                {asset.kind === 'pdf' ? (
                  <FileTextIcon className="w-4 h-4" />
                ) : asset.kind === 'video' ? (
                  <VideoIcon className="w-4 h-4" />
                ) : (
                  <ImageIcon className="w-4 h-4" />
                )}
              </div>
              <span className="text-[10px] text-fm-on-surface-variant max-w-[56px] truncate">
                {label}
              </span>
              {pinCount > 0 && (
                <span className="text-[9px] bg-fm-primary/20 text-fm-primary rounded-full px-1.5 leading-4">
                  {pinCount}
                </span>
              )}
            </button>
          )
        })
      })}
    </div>
  )
}
