'use client'

import { useState } from 'react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { RequirementChat } from '@/components/pipeline/RequirementChat'
import { ContentReviewPanel } from '@/components/clients/review/ContentReviewPanel'

type Tab = 'chat' | 'revision'

interface ClientRequirementSheetProps {
  open: boolean
  onClose: () => void
  requirementId: string
  requirementTitle: string
  clientId: string
  currentUserId: string
  reviewStartedAt: string | null
}

function formatReviewSince(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const diffMs = new Date().getTime() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'hace unos segundos'
  if (mins < 60) return `hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `hace ${hrs} h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `hace ${days} d`
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ClientRequirementSheet({
  open,
  onClose,
  requirementId,
  requirementTitle,
  clientId,
  currentUserId,
  reviewStartedAt,
}: ClientRequirementSheetProps) {
  const [tab, setTab] = useState<Tab>('revision')
  const since = formatReviewSince(reviewStartedAt)

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent
        fullScreenOnMobile
        className="w-full flex flex-col p-0 gap-0 overflow-hidden sm:!w-[92vw] sm:!max-w-[1400px]"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-3 border-b border-fm-surface-container-high pr-14 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fm-on-surface truncate">
              {requirementTitle || 'Requerimiento'}
            </h2>
            {since && (
              <p className="text-xs text-fm-on-surface-variant mt-0.5">
                En revisión {since}
              </p>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-fm-surface-container-high flex-shrink-0">
          <button
            type="button"
            onClick={() => setTab('revision')}
            className={`flex-1 sm:flex-none sm:px-6 py-3 text-sm font-semibold transition-colors ${
              tab === 'revision'
                ? 'text-fm-primary border-b-2 border-fm-primary'
                : 'text-fm-on-surface-variant hover:text-fm-on-surface'
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <span className="material-symbols-outlined text-base">visibility</span>
              Revisión
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTab('chat')}
            className={`flex-1 sm:flex-none sm:px-6 py-3 text-sm font-semibold transition-colors ${
              tab === 'chat'
                ? 'text-fm-primary border-b-2 border-fm-primary'
                : 'text-fm-on-surface-variant hover:text-fm-on-surface'
            }`}
          >
            <span className="inline-flex items-center gap-2">
              <span className="material-symbols-outlined text-base">chat</span>
              Chat
            </span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {tab === 'revision' ? (
            <ContentReviewPanel
              active={open && tab === 'revision'}
              requirementId={requirementId}
              clientId={clientId}
              currentUserId={currentUserId}
              clientMode
            />
          ) : (
            <RequirementChat
              requirementId={requirementId}
              currentUserId={currentUserId}
              clientMode
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
