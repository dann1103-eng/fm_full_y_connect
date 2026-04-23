'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { sendMessage } from '@/app/actions/inbox'
import { EmojiPicker, insertAtCursor } from '@/components/ui/EmojiPicker'
import {
  uploadChatAttachment,
  CHAT_ATTACHMENT_MAX_BYTES,
  type UploadedChatAttachment,
} from '@/lib/supabase/upload-chat-attachment'

interface MessageComposerProps {
  conversationId: string
  placeholder?: string
}

interface PendingFile {
  file: File
  uploaded?: UploadedChatAttachment
  error?: string
  uploading: boolean
}

export function MessageComposer({ conversationId, placeholder }: MessageComposerProps) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function autoresize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setError(null)
    const arr = Array.from(files)
    for (const file of arr) {
      if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
        setError(`"${file.name}" supera el límite de 10 MB.`)
        continue
      }
      setPendingFiles((prev) => [...prev, { file, uploading: true }])
      try {
        const uploaded = await uploadChatAttachment(file, conversationId)
        setPendingFiles((prev) =>
          prev.map((p) => (p.file === file ? { ...p, uploaded, uploading: false } : p))
        )
      } catch (e) {
        setPendingFiles((prev) =>
          prev.map((p) =>
            p.file === file
              ? { ...p, error: e instanceof Error ? e.message : 'Error al subir', uploading: false }
              : p
          )
        )
      }
    }
  }

  function removeFile(file: File) {
    setPendingFiles((prev) => prev.filter((p) => p.file !== file))
  }

  function send() {
    const text = body.trim()
    const ready = pendingFiles.filter((p) => p.uploaded).map((p) => p.uploaded!) as UploadedChatAttachment[]
    const uploading = pendingFiles.some((p) => p.uploading)
    if (uploading) {
      setError('Espera a que terminen de subir los archivos.')
      return
    }
    if (!text && ready.length === 0) return

    startTransition(async () => {
      const res = await sendMessage({
        conversationId,
        body: text,
        attachments: ready,
      })
      if ('error' in res && res.error) {
        setError(res.error)
        return
      }
      setBody('')
      setPendingFiles([])
      setError(null)
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
      router.refresh()
    })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="p-4 safe-bottom border-t border-fm-surface-container-high bg-fm-surface-container-lowest">
      <div className="bg-fm-background rounded-lg border border-fm-surface-container-high p-2">
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 px-1 pb-2">
            {pendingFiles.map((p) => (
              <div
                key={p.file.name + p.file.size}
                className={cn(
                  'flex items-center space-x-2 bg-fm-surface-container-lowest border rounded-full px-3 py-1 text-xs',
                  p.error ? 'border-fm-error text-fm-error' : 'border-fm-surface-container-high text-fm-on-surface-variant'
                )}
              >
                <svg className="w-3.5 h-3.5 text-fm-primary" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z" />
                </svg>
                <span className="max-w-[180px] truncate">{p.file.name}</span>
                {p.uploading && <span className="text-[10px] text-fm-primary">subiendo...</span>}
                <button
                  onClick={() => removeFile(p.file)}
                  className="text-fm-on-surface-variant/60 hover:text-fm-error"
                  type="button"
                  aria-label="Quitar"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end space-x-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-fm-on-surface-variant hover:text-fm-primary"
            title="Adjuntar archivo"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z" />
            </svg>
          </button>
          <EmojiPicker
            align="top-left"
            triggerClassName="p-2 text-fm-on-surface-variant hover:text-fm-primary"
            onSelect={(char) => {
              const { next, caret } = insertAtCursor(textareaRef.current, body, char)
              setBody(next)
              queueMicrotask(() => {
                const el = textareaRef.current
                if (el) {
                  el.focus()
                  el.setSelectionRange(caret, caret)
                  autoresize()
                }
              })
            }}
          />
          <textarea
            ref={textareaRef}
            rows={1}
            value={body}
            onChange={(e) => {
              setBody(e.target.value)
              autoresize()
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? 'Escribe un mensaje...'}
            className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none text-sm resize-none py-2 max-h-32"
          />
          <button
            type="button"
            onClick={send}
            disabled={sending}
            className="p-2.5 bg-fm-primary text-white rounded-lg hover:opacity-90 disabled:opacity-50"
            title="Enviar"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-fm-on-surface-variant/70 px-1">
        <span>
          <b>Enter</b> para enviar · <b>Shift+Enter</b> nueva línea · Máx. 10 MB por archivo
        </span>
        {error && <span className="text-fm-error">{error}</span>}
      </div>
    </div>
  )
}
