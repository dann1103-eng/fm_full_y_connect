'use client'

import { useEffect, useRef, useState } from 'react'
import { PauseIcon, PlayIcon } from 'lucide-react'
import type { ReviewAsset, ReviewPin, ReviewVersion, ReviewComment } from '@/types/db'
import { getSignedViewUrl, createReviewPin } from '@/app/actions/content-review'
import { PinOverlay } from './PinOverlay'
import { PinCommentBubble } from './PinCommentBubble'
import { VideoTimelineMarkers } from './VideoTimelineMarkers'

interface VideoViewerProps {
  asset: ReviewAsset
  version: ReviewVersion
  pins: ReviewPin[]
  selectedPinId: string | null
  onSelectPin: (id: string | null) => void
  clientId: string
  onPinCreated: (pin: ReviewPin, comment: ReviewComment) => void
}

const WINDOW_MS = 500

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function VideoViewer({
  asset,
  version,
  pins,
  selectedPinId,
  onSelectPin,
  clientId,
  onPinCreated,
}: VideoViewerProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentMs, setCurrentMs] = useState(0)
  const [durationMs, setDurationMs] = useState<number>(version.duration_ms ?? 0)
  const [pending, setPending] = useState<{
    xPct: number
    yPct: number
    timestampMs: number
  } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)

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
    const video = videoRef.current
    if (video && !video.paused) video.pause()
    setPending({ xPct: x, yPct: y, timestampMs: Math.round((video?.currentTime ?? 0) * 1000) })
  }

  async function handleSubmitPin(body: string) {
    if (!pending) return
    setSubmitting(true)
    setError(null)
    const res = await createReviewPin({
      versionId: version.id,
      clientId,
      posXPct: pending.xPct,
      posYPct: pending.yPct,
      timestampMs: pending.timestampMs,
      body,
    })
    setSubmitting(false)
    if ('ok' in res) {
      onPinCreated(res.data.pin, res.data.comment)
      setPending(null)
    } else {
      setError(res.error)
    }
  }

  function togglePlay() {
    const v = videoRef.current
    if (!v) return
    if (v.paused) v.play()
    else v.pause()
  }

  function seekTo(ms: number) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = ms / 1000
  }

  useEffect(() => {
    if (selectedPinId == null) return
    const pin = pins.find((p) => p.id === selectedPinId)
    if (!pin || pin.timestamp_ms == null) return
    seekTo(pin.timestamp_ms)
    videoRef.current?.pause()
  }, [selectedPinId, pins])

  function handleTimelineClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!durationMs) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    seekTo(Math.max(0, Math.min(durationMs, pct * durationMs)))
  }

  const visiblePins = pins.filter(
    (p) => p.timestamp_ms != null && Math.abs(p.timestamp_ms - currentMs) <= WINDOW_MS
  )

  return (
    <div className="relative flex-1 flex flex-col overflow-hidden">
      {error && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-[#b31b25] text-white text-xs px-3 py-1.5 rounded-md shadow">
          {error}
        </div>
      )}

      <div className="flex-1 flex items-center justify-center overflow-hidden p-4">
        {url ? (
          <div
            className="relative inline-block max-w-full max-h-full cursor-crosshair"
            onClick={handleClick}
          >
            <video
              ref={videoRef}
              src={url}
              className="max-w-full max-h-[calc(92vh-260px)] block bg-black"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget
                const ms = Math.round(v.duration * 1000)
                if (!Number.isFinite(ms) || ms <= 0) return
                setDurationMs(ms)
              }}
              onTimeUpdate={(e) =>
                setCurrentMs(Math.round(e.currentTarget.currentTime * 1000))
              }
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              playsInline
            />
            {visiblePins.map((pin) => (
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
                  onSubmit={handleSubmitPin}
                  onCancel={() => setPending(null)}
                  submitting={submitting}
                />
              </>
            )}
          </div>
        ) : (
          <div className="text-[#8a8f93] text-sm">Cargando video…</div>
        )}
      </div>

      {/* Controles + timeline */}
      <div className="flex-shrink-0 bg-white border-t border-[#dfe3e6] px-4 py-2">
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            className="text-[#2a2a2a] hover:text-[#00675c] transition-colors"
            aria-label={isPlaying ? 'Pausar' : 'Reproducir'}
          >
            {isPlaying ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5" />}
          </button>
          <span className="text-[11px] font-mono text-[#595c5e] tabular-nums">
            {formatTime(currentMs)} / {formatTime(durationMs)}
          </span>
          <div
            className="relative flex-1 h-6 cursor-pointer flex items-center"
            onClick={handleTimelineClick}
          >
            <div className="w-full h-1.5 bg-[#dfe3e6] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#00675c] transition-all"
                style={{ width: `${durationMs ? (currentMs / durationMs) * 100 : 0}%` }}
              />
            </div>
            <VideoTimelineMarkers
              pins={pins}
              durationMs={durationMs}
              selectedPinId={selectedPinId}
              onSelectPin={(id) => {
                onSelectPin(id)
              }}
            />
          </div>
        </div>
        <div className="text-[10px] text-[#8a8f93] mt-1 px-8 truncate" title={asset.name}>
          {asset.name} · v{version.version_number}
        </div>
      </div>
    </div>
  )
}
