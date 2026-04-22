'use client'

import { useEffect, useState } from 'react'
import { ImageIcon, VideoIcon } from 'lucide-react'
import type { ReviewAsset, ReviewVersion } from '@/types/db'
import { getSignedViewUrl } from '@/app/actions/content-review'

interface AssetThumbnailProps {
  asset: ReviewAsset
  version: ReviewVersion
}

export function AssetThumbnail({ asset, version }: AssetThumbnailProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let cancelled = false
    const path = version.thumbnail_path ?? (asset.kind === 'image' ? version.storage_path : null)
    if (!path) {
      setUrl(null)
      return
    }
    getSignedViewUrl({ storagePath: path }).then((res) => {
      if (cancelled) return
      if ('ok' in res) {
        setUrl(res.data.url)
      } else {
        setErrored(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [asset.kind, version.storage_path, version.thumbnail_path])

  if (url && !errored) {
    return (
      <div className="relative w-full aspect-video bg-[#e8ebed]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={asset.name}
          className="w-full h-full object-cover"
          onError={() => setErrored(true)}
        />
      </div>
    )
  }

  return (
    <div className="w-full aspect-video bg-[#e8ebed] flex items-center justify-center text-[#8a8f93]">
      {asset.kind === 'video' ? (
        <VideoIcon className="w-6 h-6" />
      ) : (
        <ImageIcon className="w-6 h-6" />
      )}
    </div>
  )
}
