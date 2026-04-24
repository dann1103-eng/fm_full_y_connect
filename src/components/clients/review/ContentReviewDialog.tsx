'use client'

import { useEffect } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { XIcon } from 'lucide-react'
import { ContentReviewPanel } from './ContentReviewPanel'

interface ContentReviewDialogProps {
  open: boolean
  onClose: () => void
  requirementId: string
  clientId: string
  requirementTitle: string
  currentUserId: string
  /** Deep-link: seleccionar este pin (y su asset/versión) al abrir. */
  initialPinId?: string | null
}

export function ContentReviewDialog({
  open,
  onClose,
  requirementId,
  clientId,
  requirementTitle,
  currentUserId,
  initialPinId = null,
}: ContentReviewDialogProps) {
  useEffect(() => {
    if (!open) return
    document.body.classList.add('review-dialog-open')
    return () => {
      document.body.classList.remove('review-dialog-open')
    }
  }, [open])

  function handleOpenChange(next: boolean) {
    if (!next) onClose()
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[95vw] h-[92vh] max-w-[1600px] bg-fm-surface-container-lowest rounded-2xl shadow-2xl ring-1 ring-black/10 flex flex-col overflow-hidden outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-fm-surface-container-high flex-shrink-0">
            <DialogPrimitive.Title className="text-base font-semibold text-fm-on-surface truncate">
              {requirementTitle}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="text-fm-on-surface-variant hover:text-fm-on-surface transition-colors rounded-md p-1 hover:bg-fm-surface-container"
              aria-label="Cerrar"
            >
              <XIcon className="w-5 h-5" />
            </DialogPrimitive.Close>
          </div>

          <ContentReviewPanel
            active={open}
            requirementId={requirementId}
            clientId={clientId}
            currentUserId={currentUserId}
            initialPinId={initialPinId}
          />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
