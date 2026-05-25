'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FileTextIcon } from 'lucide-react'
import type {
  ReviewAsset,
  ReviewPin,
  ReviewVersion,
  ReviewVersionFile,
  ReviewComment,
  UserRole,
} from '@/types/db'
import { getSignedViewUrl, createReviewPin } from '@/app/actions/content-review'
import { PinOverlay } from './PinOverlay'
import { PinCommentBubble } from './PinCommentBubble'
import { PinHoverBubble } from './PinHoverBubble'

interface UserMini {
  id: string
  full_name: string
  avatar_url: string | null
  role: UserRole
}

interface PdfViewerProps {
  asset: ReviewAsset
  version: ReviewVersion
  file: ReviewVersionFile
  pins: ReviewPin[]              // ya filtrados por page_number === currentPage
  selectedPinId: string | null
  onSelectPin: (id: string | null) => void
  clientId: string
  users: UserMini[]
  commentsByPin: Record<string, ReviewComment[]>
  onPinCreated: (pin: ReviewPin, comment: ReviewComment) => void
  currentPage: number            // 0-based, controlado por el padre
  onPageChange: (page: number) => void
}

export function PdfViewer({
  asset,
  version,
  file,
  pins,
  selectedPinId,
  onSelectPin,
  clientId,
  users,
  commentsByPin,
  onPinCreated,
  currentPage,
  onPageChange,
}: PdfViewerProps) {
  const [url, setUrl] = useState<string | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pdfDoc, setPdfDoc] = useState<any>(null)
  const [totalPages, setTotalPages] = useState(0)
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{ xPct: number; yPct: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [hoveredPinId, setHoveredPinId] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const workerInitializedRef = useRef(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderTaskRef = useRef<any>(null)

  // 1. Signed URL
  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(null)
    setPdfDoc(null)
    setPending(null)
    setError(null)
    getSignedViewUrl({ storagePath: file.storage_path }).then((res) => {
      if (cancelled) return
      if ('ok' in res) setUrl(res.data.url)
      else setError(res.error)
    })
    return () => { cancelled = true }
  }, [file.storage_path])

  // 2. Load PDF document
  useEffect(() => {
    if (!url) return
    let cancelled = false
    void (async () => {
      try {
        const pdfjsLib = await import('pdfjs-dist')
        if (!workerInitializedRef.current) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            'pdfjs-dist/build/pdf.worker.min.mjs',
            import.meta.url,
          ).toString()
          workerInitializedRef.current = true
        }
        const doc = await pdfjsLib.getDocument(url).promise
        if (cancelled) return
        setPdfDoc(doc)
        setTotalPages(doc.numPages)
      } catch {
        if (!cancelled) setError('Error al cargar el PDF.')
      }
    })()
    return () => { cancelled = true }
  }, [url])

  // 3. Render current page to canvas
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return
    let cancelled = false
    renderTaskRef.current?.cancel()
    void (async () => {
      setRendering(true)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let page: any = null
      try {
        page = await pdfDoc.getPage(currentPage + 1) // PDF.js es 1-based
        if (cancelled) { page.cleanup(); return }
        const canvas = canvasRef.current!
        const viewport = page.getViewport({ scale: 1.5 })
        canvas.width = viewport.width
        canvas.height = viewport.height
        const ctx = canvas.getContext('2d')!
        const task = page.render({ canvasContext: ctx, viewport })
        renderTaskRef.current = task
        await task.promise
        if (!cancelled) setRendering(false)
      } catch (e: unknown) {
        page?.cleanup()
        if (
          !cancelled &&
          (e as { name?: string }).name !== 'RenderingCancelledException'
        ) {
          setError('Error al renderizar la página.')
        }
        if (!cancelled) setRendering(false)
      }
    })()
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
    }
  }, [pdfDoc, currentPage])

  // 4. Reset hover state when file changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHoveredPinId(null)
  }, [file.id])

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (selectedPinId) { onSelectPin(null); return }
    if (pending) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    if (x < 0 || x > 100 || y < 0 || y > 100) return
    setPending({ xPct: x, yPct: y })
  }

  const handleSubmitPin = useCallback(
    async (body: string, mentionedUserIds: string[]) => {
      if (!pending) return
      setSubmitting(true)
      setError(null)
      const res = await createReviewPin({
        versionId: version.id,
        fileId: file.id,
        clientId,
        posXPct: pending.xPct,
        posYPct: pending.yPct,
        timestampMs: null,
        pageNumber: currentPage,
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
    },
    [pending, version.id, file.id, clientId, currentPage, onPinCreated],
  )

  return (
    <div className="relative flex-1 flex flex-col items-center min-h-0 overflow-hidden">
      {error && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-fm-error text-white text-xs px-3 py-1.5 rounded-md shadow">
          {error}
        </div>
      )}

      {/* Navegación de páginas */}
      {totalPages > 0 && (
        <div className="flex items-center gap-3 py-1.5 flex-shrink-0 text-xs text-fm-on-surface-variant">
          <button type="button"
            onClick={() => onPageChange(Math.max(0, currentPage - 1))}
            disabled={currentPage === 0}
            className="px-2 py-0.5 rounded bg-fm-surface-container hover:bg-fm-surface-container-high disabled:opacity-40 transition-colors"
          >
            ◀
          </button>
          <span className="font-medium">Página {currentPage + 1} / {totalPages}</span>
          <button type="button"
            onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))}
            disabled={currentPage === totalPages - 1}
            className="px-2 py-0.5 rounded bg-fm-surface-container hover:bg-fm-surface-container-high disabled:opacity-40 transition-colors"
          >
            ▶
          </button>
        </div>
      )}

      {/* Canvas + pins overlay */}
      <div className="flex-1 flex items-center justify-center min-h-0 w-full overflow-hidden">
        {pdfDoc ? (
          <div
            className="relative inline-block max-w-full cursor-crosshair"
            onClick={handleClick}
          >
            <canvas
              ref={canvasRef}
              className="max-w-full max-h-[50vh] md:max-h-[calc(92vh-260px)] block select-none"
            />
            {rendering && (
              <div className="absolute inset-0 flex items-center justify-center bg-fm-surface-container/50">
                <span className="text-xs text-fm-on-surface-variant">Renderizando…</span>
              </div>
            )}
            {pins.map((pin) => (
              <PinOverlay
                key={pin.id}
                pin={pin}
                selected={pin.id === selectedPinId}
                onClick={() => onSelectPin(pin.id)}
                onHoverStart={() => setHoveredPinId(pin.id)}
                onHoverEnd={() =>
                  setHoveredPinId((cur) => (cur === pin.id ? null : cur))
                }
              />
            ))}
            {(() => {
              if (!hoveredPinId || hoveredPinId === selectedPinId || pending) return null
              const hoveredPin = pins.find((p) => p.id === hoveredPinId)
              if (!hoveredPin) return null
              const firstComment = (commentsByPin[hoveredPin.id] ?? [])[0]
              if (!firstComment) return null
              const author = users.find((u) => u.id === firstComment.user_id) ?? null
              return (
                <PinHoverBubble
                  xPct={hoveredPin.pos_x_pct}
                  yPct={hoveredPin.pos_y_pct}
                  comment={firstComment}
                  author={author}
                />
              )
            })()}
            {pending && (
              <>
                <div
                  className="absolute -translate-x-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-fm-primary text-white flex items-center justify-center text-[11px] font-bold shadow-md ring-2 ring-white"
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
          <div className="flex flex-col items-center gap-2 text-fm-on-surface-variant text-sm">
            <FileTextIcon className="w-8 h-8 opacity-40" />
            <span>Cargando PDF…</span>
          </div>
        )}
      </div>

      {/* Strip de páginas (solo si > 1 página) */}
      {totalPages > 1 && (
        <div className="flex gap-1 py-1.5 px-2 overflow-x-auto flex-shrink-0 border-t border-fm-surface-container-high/60">
          {Array.from({ length: totalPages }, (_, i) => (
            <button type="button"
              key={i}
              onClick={() => onPageChange(i)}
              title={`Página ${i + 1}`}
              className={`flex-shrink-0 w-7 h-9 rounded border-2 text-[10px] font-medium transition-colors ${
                i === currentPage
                  ? 'border-fm-primary bg-fm-primary/10 text-fm-primary'
                  : 'border-fm-surface-container-high text-fm-on-surface-variant hover:border-fm-primary/50'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
