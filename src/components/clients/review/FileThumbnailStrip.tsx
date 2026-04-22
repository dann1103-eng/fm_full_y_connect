'use client'

import { useEffect, useState } from 'react'
import { PlayIcon } from 'lucide-react'
import type { ReviewVersionFile, ReviewPin } from '@/types/db'
import { getSignedViewUrl } from '@/app/actions/content-review'

interface FileThumbnailStripProps {
  files: ReviewVersionFile[]
  selectedFileId: string | null
  onSelect: (fileId: string) => void
  pins: ReviewPin[]
}

export function FileThumbnailStrip({
  files,
  selectedFileId,
  onSelect,
  pins,
}: FileThumbnailStripProps) {
  if (files.length <= 1) return null

  return (
    <div className="flex-shrink-0 bg-fm-surface-container-lowest border-t border-fm-surface-container-high px-3 py-2">
      <div className="flex items-center gap-2 overflow-x-auto">
        {files.map((f, idx) => {
          const active = pins.filter(
            (p) => p.file_id === f.id && p.status === 'active',
          ).length
          const isSelected = f.id === selectedFileId
          return (
            <button
              key={f.id}
              onClick={() => onSelect(f.id)}
              className={`relative flex-shrink-0 w-16 h-16 rounded-md overflow-hidden transition-all ${
                isSelected
                  ? 'ring-2 ring-fm-primary ring-offset-1 ring-offset-fm-surface-container-lowest'
                  : 'ring-1 ring-fm-surface-container-high hover:ring-fm-on-surface-variant'
              }`}
              title={`Archivo ${idx + 1}`}
            >
              <FileThumb file={f} />
              <div className="absolute top-0.5 left-0.5 bg-black/60 text-white text-[9px] font-semibold px-1 rounded">
                {idx + 1}
              </div>
              {active > 0 && (
                <div className="absolute top-0.5 right-0.5 bg-fm-error text-white text-[9px] font-semibold px-1 rounded-full min-w-[14px] text-center">
                  {active}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function FileThumb({ file }: { file: ReviewVersionFile }) {
  const [url, setUrl] = useState<string | null>(null)
  const isVideo = file.mime_type.startsWith('video/')
  const path = isVideo ? file.thumbnail_path ?? file.storage_path : file.storage_path

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(null)
    getSignedViewUrl({ storagePath: path }).then((res) => {
      if (cancelled) return
      if ('ok' in res) setUrl(res.data.url)
    })
    return () => {
      cancelled = true
    }
  }, [path])

  if (!url) {
    return (
      <div className="w-full h-full bg-fm-surface-container-high animate-pulse" />
    )
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="w-full h-full object-cover" />
      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <PlayIcon className="w-4 h-4 text-white drop-shadow" fill="white" />
        </div>
      )}
    </>
  )
}
