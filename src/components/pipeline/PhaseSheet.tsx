'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createClient } from '@/lib/supabase/client'
import {
  PHASES,
  PHASE_LABELS,
  movePhase,
} from '@/lib/domain/pipeline'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import type { Phase, ContentType, ConsumptionPhaseLog } from '@/types/db'

interface PhaseSheetProps {
  open: boolean
  onClose: () => void
  consumptionId: string
  contentType: ContentType
  currentPhase: Phase
  clientName: string
  logs: ConsumptionPhaseLog[]
  currentUserId: string
}

export function PhaseSheet({
  open,
  onClose,
  consumptionId,
  contentType,
  currentPhase,
  clientName,
  logs,
  currentUserId,
}: PhaseSheetProps) {
  const router = useRouter()
  const [toPhase, setToPhase] = useState<Phase>(currentPhase)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleMove() {
    if (toPhase === currentPhase) {
      setError('Selecciona una fase diferente a la actual.')
      return
    }
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error: moveError } = await movePhase(supabase, {
      consumptionId,
      currentPhase,
      contentType,
      toPhase,
      movedBy: currentUserId,
      notes,
    })

    setLoading(false)

    if (moveError) {
      setError(moveError)
      return
    }

    setNotes('')
    onClose()
    router.refresh()
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-[#2c2f31]">
            {CONTENT_TYPE_LABELS[contentType]}
          </SheetTitle>
          <p className="text-sm text-[#595c5e]">{clientName}</p>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Timeline */}
          <div>
            <p className="text-xs font-semibold text-[#747779] uppercase tracking-wide mb-3">
              Historial
            </p>
            <ol className="relative border-l border-[#dfe3e6] space-y-4 ml-2">
              {logs.map((log) => (
                <li key={log.id} className="ml-4">
                  <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-white bg-[#00675c]" />
                  <p className="text-xs text-[#747779]">
                    {new Date(log.created_at).toLocaleDateString('es-SV', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  <p className="text-sm font-medium text-[#2c2f31]">
                    {log.from_phase
                      ? `${PHASE_LABELS[log.from_phase as Phase]} → ${PHASE_LABELS[log.to_phase as Phase]}`
                      : `Creado en ${PHASE_LABELS[log.to_phase as Phase]}`}
                  </p>
                  {log.notes && (
                    <p className="text-xs text-[#595c5e] mt-0.5">{log.notes}</p>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {/* Mover de fase */}
          <div className="space-y-3 border-t border-[#dfe3e6] pt-5">
            <p className="text-xs font-semibold text-[#747779] uppercase tracking-wide">
              Mover a fase
            </p>

            <div>
              <Label className="text-sm text-[#2c2f31] mb-1.5 block">Nueva fase</Label>
              <Select value={toPhase} onValueChange={(v) => setToPhase(v as Phase)}>
                <SelectTrigger className="rounded-xl border-[#dfe3e6]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PHASES.map((phase) => (
                    <SelectItem key={phase} value={phase}>
                      {PHASE_LABELS[phase]}
                      {phase === currentPhase ? ' (actual)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="phase-notes" className="text-sm text-[#2c2f31] mb-1.5 block">
                Notas <span className="text-[#747779] font-normal">(opcional)</span>
              </Label>
              <Textarea
                id="phase-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej. cliente pidió cambiar el copy..."
                className="resize-none bg-[#f5f7f9] border-[#dfe3e6] focus:border-[#00675c] rounded-xl"
                rows={3}
              />
            </div>

            {error && (
              <p className="text-sm text-[#b31b25] bg-[#b31b25]/5 rounded-xl px-3 py-2 border border-[#b31b25]/20">
                {error}
              </p>
            )}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1 rounded-xl border-[#dfe3e6] text-[#595c5e]"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleMove}
                disabled={loading || toPhase === currentPhase}
                className="flex-1 rounded-xl text-white font-semibold"
                style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
              >
                {loading ? 'Moviendo...' : 'Mover'}
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
