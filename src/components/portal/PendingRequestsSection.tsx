'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cancelRequirementRequest } from '@/app/actions/requirementRequests'
import { ClientRequestRequirementModal } from './ClientRequestRequirementModal'
import type { ContentType, ClientRequestAttachment, ClientRequestLink } from '@/types/db'

export interface PendingRequestItem {
  id: string
  title: string
  content_type: string
  notes: string | null
  client_requested_deadline: string | null
  includes_story: boolean
  approval_status: 'pending' | 'rejected'
  rejected_reason: string | null
  client_request_attachments_json: ClientRequestAttachment[] | null
  client_request_links_json: ClientRequestLink[] | null
}

interface Props {
  requests: PendingRequestItem[]
}

export function PendingRequestsSection({ requests }: Props) {
  const router = useRouter()
  const [editingItem, setEditingItem] = useState<PendingRequestItem | null>(null)
  const [confirmWithdrawId, setConfirmWithdrawId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (requests.length === 0) return null

  const pending = requests.filter((r) => r.approval_status === 'pending')
  const rejected = requests.filter((r) => r.approval_status === 'rejected')

  function handleWithdrawConfirm(id: string) {
    startTransition(async () => {
      await cancelRequirementRequest(id)
      setConfirmWithdrawId(null)
      router.refresh()
    })
  }

  function handleModalClose() {
    setEditingItem(null)
    router.refresh()
  }

  return (
    <>
      {editingItem && (
        <ClientRequestRequirementModal
          open
          onClose={handleModalClose}
          existingRequest={{
            id: editingItem.id,
            contentType: editingItem.content_type as ContentType,
            title: editingItem.title,
            notes: editingItem.notes ?? '',
            clientRequestedDeadline: editingItem.client_requested_deadline,
            includesStory: editingItem.includes_story,
            attachments: editingItem.client_request_attachments_json ?? [],
            links: editingItem.client_request_links_json ?? [],
          }}
        />
      )}

      <div className="space-y-3">
        {/* Solicitudes pendientes */}
        {pending.length > 0 && (
          <div className="glass-panel rounded-[2rem] p-4 sm:p-6 space-y-3">
            <h3 className="text-base font-semibold text-fm-on-surface">
              Solicitudes en revisión
            </h3>
            <div className="space-y-3">
              {pending.map((item) => {
                const attachCount = (item.client_request_attachments_json ?? []).length
                const linkCount = (item.client_request_links_json ?? []).length
                const isConfirming = confirmWithdrawId === item.id

                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/60 dark:bg-amber-950/20 px-4 py-3 space-y-2"
                  >
                    {/* Header row */}
                    <div className="flex items-start gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex-shrink-0">
                        <span className="material-symbols-outlined text-[13px] leading-none">schedule</span>
                        Pendiente de revisión
                      </span>
                      <span className="text-sm font-medium text-fm-on-surface flex-1 min-w-0 truncate">
                        {item.title}
                      </span>
                    </div>

                    {/* Actions row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setEditingItem(item)}
                        disabled={isPending}
                        className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-fm-surface-container-low border border-fm-surface-container-high text-fm-on-surface-variant hover:text-fm-primary hover:border-fm-primary/30 transition-colors disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[13px] leading-none">edit</span>
                        Editar
                      </button>

                      {isConfirming ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-fm-on-surface-variant">¿Retirar?</span>
                          <button
                            type="button"
                            onClick={() => handleWithdrawConfirm(item.id)}
                            disabled={isPending}
                            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50"
                          >
                            {isPending ? '…' : 'Sí'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmWithdrawId(null)}
                            disabled={isPending}
                            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-fm-surface-container-low border border-fm-surface-container-high text-fm-on-surface-variant hover:text-fm-on-surface transition-colors disabled:opacity-50"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmWithdrawId(item.id)}
                          disabled={isPending}
                          className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg bg-fm-surface-container-low border border-fm-surface-container-high text-fm-on-surface-variant hover:text-red-600 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-800 transition-colors disabled:opacity-50"
                        >
                          <span className="material-symbols-outlined text-[13px] leading-none">close</span>
                          Retirar
                        </button>
                      )}
                    </div>

                    {/* Meta row */}
                    {(item.client_requested_deadline || attachCount > 0 || linkCount > 0) && (
                      <div className="flex items-center gap-3 flex-wrap">
                        {item.client_requested_deadline && (
                          <span className="inline-flex items-center gap-1 text-xs text-fm-on-surface-variant">
                            <span className="material-symbols-outlined text-[13px] leading-none">calendar_today</span>
                            {item.client_requested_deadline.slice(0, 10)}
                          </span>
                        )}
                        {attachCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs text-fm-on-surface-variant">
                            <span className="material-symbols-outlined text-[13px] leading-none">attach_file</span>
                            {attachCount} {attachCount === 1 ? 'archivo' : 'archivos'}
                          </span>
                        )}
                        {linkCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs text-fm-on-surface-variant">
                            <span className="material-symbols-outlined text-[13px] leading-none">link</span>
                            {linkCount} {linkCount === 1 ? 'link' : 'links'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Solicitudes rechazadas */}
        {rejected.length > 0 && (
          <div className="glass-panel rounded-[2rem] p-4 sm:p-6 space-y-3">
            <h3 className="text-base font-semibold text-fm-on-surface">
              Solicitudes no aprobadas
            </h3>
            <div className="space-y-3">
              {rejected.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-red-200 dark:border-red-900/40 bg-red-50/60 dark:bg-red-950/20 px-4 py-3 space-y-2"
                >
                  <div className="flex items-start gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 flex-shrink-0">
                      <span className="material-symbols-outlined text-[13px] leading-none">block</span>
                      No aprobada
                    </span>
                    <span className="text-sm font-medium text-fm-on-surface flex-1 min-w-0 truncate">
                      {item.title}
                    </span>
                  </div>
                  {item.rejected_reason && (
                    <p className="text-xs text-red-700 dark:text-red-300 bg-red-100/60 dark:bg-red-950/30 rounded-xl px-3 py-2">
                      {item.rejected_reason}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
