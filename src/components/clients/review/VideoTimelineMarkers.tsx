'use client'

import type { ReviewPin } from '@/types/db'

interface VideoTimelineMarkersProps {
  pins: ReviewPin[]
  durationMs: number
  selectedPinId: string | null
  onSelectPin: (id: string) => void
}

export function VideoTimelineMarkers({
  pins,
  durationMs,
  selectedPinId,
  onSelectPin,
}: VideoTimelineMarkersProps) {
  if (!durationMs || durationMs <= 0) return null

  return (
    <div className="absolute inset-x-0 top-0 h-full pointer-events-none">
      {pins.map((pin) => {
        if (pin.timestamp_ms == null) return null
        const pct = Math.max(0, Math.min(100, (pin.timestamp_ms / durationMs) * 100))
        const selected = pin.id === selectedPinId
        return (
          <button
            key={pin.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSelectPin(pin.id)
            }}
            className={`absolute -translate-x-1/2 top-1/2 -translate-y-1/2 pointer-events-auto flex items-center justify-center text-[10px] font-bold rounded-sm transition-all ${
              selected
                ? 'bg-[#00675c] text-white w-5 h-5 ring-2 ring-white scale-110 z-10'
                : 'bg-white text-[#00675c] ring-2 ring-[#00675c] w-4 h-4 hover:scale-110'
            }`}
            style={{ left: `${pct}%` }}
            aria-label={`Pin ${pin.pin_number} en ${Math.round(pin.timestamp_ms / 1000)}s`}
          >
            {pin.pin_number}
          </button>
        )
      })}
    </div>
  )
}
