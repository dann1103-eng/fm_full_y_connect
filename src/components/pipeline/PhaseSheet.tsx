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
      {/* Layout: flex-col h-full → header fijo + cuerpo scrollable + footer fijo */}
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0 gap-0">

        {/* ── Header ── */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-[#dfe3e6] pr-14">
          <SheetTitle className="text-base font-semibold text-[#2c2f31] leading-tight">
            {CONTENT_TYPE_LABELS[contentType]}
          </SheetTitle>
          <p className="text-sm text-[#595c5e] mt-0.5">{clientName}</p>
        </SheetHeader>

        {/* ── Cuerpo scrollable ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* Fase actual */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#747779]">Fase actual:</span>
            <span className="text-xs font-semibold bg-[#00675c]/10 text-[#00675c] px-2.5 py-1 rounded-full">
              {PHASE_LABELS[currentPhase]}
            </span>
          </div>

          {/* Timeline de historial */}
          <div>
            <p className="text-xs font-semibold text-[#747779] uppercase tracking-wider mb-4">
              Historial
            </p>
            {logs.length === 0 ? (
              <p className="text-sm text-[#abadaf] italic">Sin movimientos registrados.</p>
            ) : (
              <ol className="space-y-0">
                {logs.map((log, idx) => (
                  <li key={log.id} className="flex gap-3">
                    {/* Línea + punto */}
                    <div className="flex flex-col items-center">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#00675c] flex-shrink-0 mt-1" />
                      {idx < logs.length - 1 && (
                        <div className="w-px flex-1 bg-[#dfe3e6] my-1" />
                      )}
                    </div>
                    {/* Contenido */}
                    <div className="pb-5 min-w-0">
                      <p className="text-xs text-[#abadaf] mb-0.5">
                        {new Date(log.created_at).toLocaleDateString('es-SV', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                      <p className="text-sm font-medium text-[#2c2f31] leading-snug">
                        {log.from_phase
                          ? `${PHASE_LABELS[log.from_phase as Phase]} → ${PHASE_LABELS[log.to_phase as Phase]}`
                          : `Creado en ${PHASE_LABELS[log.to_phase as Phase]}`}
                      </p>
                      {log.notes && (
                        <p className="text-xs text-[#595c5e] mt-1 bg-[#f5f7f9] rounded-lg px-2.5 py-1.5">
                          {log.notes}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Formulario mover de fase */}
          <div className="space-y-4 border-t border-[#dfe3e6] pt-5">
            <p className="text-xs font-semibold text-[#747779] uppercase tracking-wider">
              Mover a fase
            </p>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-[#2c2f31]">Nueva fase</Label>
              <Select value={toPhase} onValueChange={(v) => setToPhase(v as Phase)}>
                <SelectTrigger className="rounded-xl border-[#dfe3e6] bg-white h-10">
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

            <div className="space-y-1.5">
              <Label htmlFor="phase-notes" className="text-sm font-medium text-[#2c2f31]">
                Notas{' '}
                <span className="text-[#abadaf] font-normal">(opcional)</span>
              </Label>
              <Textarea
                id="phase-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ej. cliente pidió cambiar el copy..."
                className="resize-none bg-[#f5f7f9] border-[#dfe3e6] focus:border-[#00675c] rounded-xl text-sm"
                rows={3}
              />
            </div>

            {error && (
              <p className="text-sm text-[#b31b25] bg-[#b31b25]/5 rounded-xl px-3 py-2.5 border border-[#b31b25]/20">
                {error}
              </p>
            )}
          </div>
        </div>

        {/* ── Footer fijo con botones ── */}
        <div className="px-6 py-4 border-t border-[#dfe3e6] bg-white flex gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 rounded-xl border-[#dfe3e6] text-[#595c5e] h-10"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleMove}
            disabled={loading || toPhase === currentPhase}
            className="flex-1 rounded-xl text-white font-semibold h-10"
            style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
          >
            {loading ? 'Moviendo...' : 'Mover'}
          </Button>
        </div>

      </SheetContent>
    </Sheet>
  )
}
