'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'
import { movePhase, PHASE_LABELS } from '@/lib/domain/pipeline'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import type { PipelineItem } from '@/lib/domain/pipeline'
import type { Phase } from '@/types/db'

interface MovePhaseModalProps {
  open: boolean
  item: PipelineItem | null
  fromPhase: Phase | null
  toPhase: Phase | null
  currentUserId: string
  onClose: () => void
}

export function MovePhaseModal({
  open,
  item,
  fromPhase,
  toPhase,
  currentUserId,
  onClose,
}: MovePhaseModalProps) {
  const router = useRouter()
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (!item || !fromPhase || !toPhase) return
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: moveError } = await movePhase(supabase, {
      requirementId: item.id,
      currentPhase: fromPhase,
      contentType: item.content_type,
      toPhase,
      movedBy: currentUserId,
      notes: notes.trim() || undefined,
    })

    if (moveError) {
      setError(moveError)
      setLoading(false)
      return
    }

    setNotes('')
    setLoading(false)
    router.refresh()
    onClose()
  }

  function handleClose() {
    if (loading) return
    setNotes('')
    setError(null)
    onClose()
  }

  if (!item || !fromPhase || !toPhase) return null

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-sm rounded-2xl border border-fm-outline-variant/20 p-0">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="text-base font-semibold text-fm-on-surface">
            Mover pieza
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-6 pt-4 space-y-4">
          {/* Client + type */}
          <div>
            <p className="text-sm font-medium text-fm-on-surface">{item.client_name}</p>
            <p className="text-xs text-fm-on-surface-variant">{CONTENT_TYPE_LABELS[item.content_type]}</p>
          </div>

          {/* Phase transition pill */}
          <div className="flex items-center gap-2 text-sm">
            <span className="px-3 py-1 bg-fm-background text-fm-on-surface-variant rounded-full font-medium text-xs">
              {PHASE_LABELS[fromPhase]}
            </span>
            <span className="text-fm-outline-variant">→</span>
            <span className="px-3 py-1 bg-fm-primary/10 text-fm-primary rounded-full font-semibold text-xs">
              {PHASE_LABELS[toPhase]}
            </span>
          </div>

          {/* Optional notes */}
          <div>
            <label className="text-xs font-medium text-fm-on-surface-variant block mb-1.5">
              Nota <span className="font-normal text-fm-outline-variant">(opcional)</span>
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. enviado a diseño, pendiente aprobación…"
              className="resize-none bg-fm-background border-fm-surface-container-high rounded-xl text-sm"
              rows={3}
              disabled={loading}
            />
          </div>

          {error && (
            <p className="text-sm text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={loading}
              className="flex-1 rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={loading}
              className="flex-1 rounded-xl text-white font-semibold"
              style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
            >
              {loading ? 'Moviendo…' : 'Confirmar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
