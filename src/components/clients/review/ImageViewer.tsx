'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReviewAsset, ReviewPin, ReviewVersion, ReviewComment, UserRole } from '@/types/db'
import { getSignedViewUrl, createReviewPin } from '@/app/actions/content-review'
import { PinOverlay } from './PinOverlay'
import { PinCommentBubble } from './PinCommentBubble'

interface UserMini {
  id: string
  full_name: string
  avatar_url: string | null
  role: UserRole
}

interface ImageViewerProps {
  asset: ReviewAsset
  version: ReviewVersion
  pins: ReviewPin[]
  selectedPinId: string | null
  onSelectPin: (id: string | null) => void
  clientId: string
  users: UserMini[]
  onPinCreated: (pin: ReviewPin, comment: ReviewComment) => void
}

export function ImageViewer({
  asset,
  version,
  pins,
  selectedPinId,
  onSelectPin,
  clientId,
  users,
  onPinCreated,
}: ImageViewerProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [pending, setPending] = useState<{ xPct: number; yPct: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setUrl(null)
    getSignedViewUrl({ storagePath: version.storage_path }).then((res) => {
      if (cancelled) return
      if ('ok' in res) setUrl(res.data.url)
      else setError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [version.storage_path])

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (selectedPinId) {
      onSelectPin(null)
      return
    }
    if (pending) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    if (x < 0 || x > 100 || y < 0 || y > 100) return
    setPending({ xPct: x, yPct: y })
  }

  async function handleSubmitPin(body: string, mentionedUserIds: string[]) {
    if (!pending) return
    setSubmitting(true)
    setError(null)
    const res = await createReviewPin({
      versionId: version.id,
      clientId,
      posXPct: pending.xPct,
      posYPct: pending.yPct,
      timestampMs: null,
      body,
      mentionedUserIds,
    })
    setSubmitting(false)
    if ('ok' in res) {
      onPinCreated(res.data.pin, res.data.comment)
      setPending(null)
    } else {
      setError(res.error)
    }
  }

  return (
    <div className="relative flex-1 flex items-center justify-center overflow-hidden">
      {error && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-[#b31b25] text-white text-xs px-3 py-1.5 rounded-md shadow">
          {error}
        </div>
      )}
      {url ? (
        <div
          className="relative inline-block max-w-full max-h-full cursor-crosshair"
          onClick={handleClick}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={url}
            alt={asset.name}
            className="max-w-full max-h-[calc(92vh-200px)] block select-none"
            draggable={false}
          />
          {pins.map((pin) => (
            <PinOverlay
              key={pin.id}
              pin={pin}
              selected={pin.id === selectedPinId}
              onClick={() => onSelectPin(pin.id)}
            />
          ))}
          {pending && (
            <>
              <div
                className="absolute -translate-x-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-[#00675c] text-white flex items-center justify-center text-[11px] font-bold shadow-md ring-2 ring-white"
                style={{ left: `${pending.xPct}%`, top: `${pending.yPct}%` }}
              >
                {pins.length + 1}
              </div>
              <PinCommentBubble
                xPct={pending.xPct}
                yPct={pending.yPct}
                users={users}
                onSubmit={handleSubmitPin}
                onCancel={() => setPending(null)}
                submitting={submitting}
              />
            </>
          )}
        </div>
      ) : (
        <div className="text-[#8a8f93] text-sm">Cargando imagen…</div>
      )}
    </div>
  )
}
