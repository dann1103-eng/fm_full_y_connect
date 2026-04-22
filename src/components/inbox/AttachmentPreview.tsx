'use client'

import { useEffect, useState } from 'react'
import { signedUrlForChatAttachment } from '@/lib/supabase/upload-chat-attachment'
import { cn } from '@/lib/utils'
import type { MessageAttachment } from '@/types/db'

interface AttachmentPreviewProps {
  attachment: MessageAttachment
  onDelete?: () => void
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  const k = 1024
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1)
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function isImage(mime: string | null): boolean {
  return !!mime && mime.startsWith('image/')
}

export function AttachmentPreview({ attachment, onDelete }: AttachmentPreviewProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState(false)

  useEffect(() => {
    let mounted = true
    signedUrlForChatAttachment(attachment.storage_path).then((u) => {
      if (mounted) setUrl(u)
    })
    return () => {
      mounted = false
    }
  }, [attachment.storage_path])

  const img = isImage(attachment.mime_type)

  if (img) {
    return (
      <>
        <div className="mt-1 rounded-lg overflow-hidden max-w-xs border border-fm-surface-container-high group/att relative">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={attachment.file_name}
              className="w-full max-h-60 object-cover cursor-zoom-in"
              onClick={() => setLightbox(true)}
            />
          ) : (
            <div className="w-60 h-40 bg-fm-background animate-pulse" />
          )}
          <div className="flex items-center justify-between px-3 py-1.5 bg-fm-surface-container-lowest">
            <div className="text-[10px] text-fm-on-surface-variant/70 truncate">
              {attachment.file_name} · {formatBytes(attachment.file_size)}
            </div>
            <div className="flex items-center gap-2">
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-fm-on-surface-variant/70 hover:text-fm-primary"
                  title="Descargar"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                  </svg>
                </a>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="text-fm-on-surface-variant/70 hover:text-fm-error"
                  title="Eliminar"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {lightbox && url && (
          <div
            className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
            onClick={() => setLightbox(false)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={attachment.file_name} className="max-h-full max-w-full object-contain" />
          </div>
        )}
      </>
    )
  }

  const isPdf = attachment.mime_type === 'application/pdf'
  return (
    <div
      className={cn(
        'mt-1 bg-fm-surface-container-lowest border border-fm-surface-container-high rounded-lg p-2.5 flex items-center space-x-3 w-72',
        url && 'hover:shadow-sm'
      )}
    >
      <div
        className={cn(
          'w-9 h-9 rounded flex items-center justify-center flex-shrink-0',
          isPdf ? 'bg-fm-error/10 text-fm-error' : 'bg-fm-primary/10 text-fm-primary'
        )}
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
        </svg>
      </div>
      <div className="flex-1 overflow-hidden min-w-0">
        <div className="text-xs font-semibold text-fm-on-surface truncate">{attachment.file_name}</div>
        <div className="text-[10px] text-fm-on-surface-variant/70">
          {formatBytes(attachment.file_size)}
          {attachment.mime_type ? ` · ${attachment.mime_type.split('/')[1].toUpperCase()}` : ''}
        </div>
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-fm-on-surface-variant/70 hover:text-fm-primary flex-shrink-0"
          title="Descargar"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
          </svg>
        </a>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="text-fm-on-surface-variant/70 hover:text-fm-error flex-shrink-0"
          title="Eliminar"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
          </svg>
        </button>
      )}
    </div>
  )
}
