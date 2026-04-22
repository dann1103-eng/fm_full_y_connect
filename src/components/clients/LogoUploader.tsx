'use client'

import { useRef, useState } from 'react'
import { uploadClientLogo } from '@/lib/supabase/upload-logo'

interface LogoUploaderProps {
  value: string | null
  onChange: (url: string | null) => void
  clientId: string
  clientName: string
  disabled?: boolean
}

export function LogoUploader({ value, onChange, clientId, clientName, disabled }: LogoUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initials = clientName
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  async function handleFile(file: File) {
    setError(null)
    setUploading(true)
    try {
      const url = await uploadClientLogo(file, clientId)
      onChange(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al subir el logo.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        {/* Preview */}
        <div className="w-16 h-16 rounded-2xl overflow-hidden border border-fm-surface-container-high flex-shrink-0 bg-fm-background flex items-center justify-center">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt={clientName} className="w-full h-full object-cover" />
          ) : (
            <span className="text-lg font-black text-fm-outline-variant">{initials}</span>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={disabled || uploading}
              onClick={() => inputRef.current?.click()}
              className="px-3 py-1.5 text-xs font-semibold border border-fm-surface-container-high rounded-lg hover:bg-fm-background transition-colors disabled:opacity-50"
            >
              {uploading ? 'Subiendo...' : value ? 'Cambiar logo' : 'Subir logo'}
            </button>
            {value && (
              <button
                type="button"
                disabled={disabled || uploading}
                onClick={() => { onChange(null); setError(null) }}
                className="px-3 py-1.5 text-xs font-semibold text-fm-error border border-fm-error/30 rounded-lg hover:bg-fm-error/5 transition-colors disabled:opacity-50"
              >
                Quitar
              </button>
            )}
          </div>
          <p className="text-[11px] text-fm-outline-variant">PNG, JPG, WebP o SVG · máx. 2 MB</p>
        </div>
      </div>

      {error && (
        <p className="text-xs text-fm-error bg-fm-error/5 rounded-lg px-3 py-2 border border-fm-error/20">
          {error}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
