'use client'

import { useState, useEffect } from 'react'
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
import { PHASES, PHASE_LABELS, PHASE_CATEGORY, isPassiveTimerPhase } from '@/lib/domain/pipeline'
import { movePhase } from '@/lib/domain/pipeline'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import type { Phase, ContentType, RequirementPhaseLog, Priority } from '@/types/db'
import { PRIORITY_LABELS, PRIORITY_COLORS } from '@/types/db'
import { RequirementChat } from './RequirementChat'
import { RequirementTimesheet } from './RequirementTimesheet'

type Tab = 'fases' | 'chat' | 'tiempo'

interface PhaseSheetProps {
  open: boolean
  onClose: () => void
  requirementId: string
  contentType: ContentType
  currentPhase: Phase
  clientName: string
  logs: RequirementPhaseLog[]
  currentUserId: string
  title: string
  requirementNotes: string | null
  cambiosCount: number
  reviewStartedAt: string | null
  showMoveSection?: boolean
  priority?: Priority
  estimatedTimeMinutes?: number | null
  assignedTo?: string | null
  assigneeName?: string | null
  canAssign?: boolean
}

export function PhaseSheet({
  open,
  onClose,
  requirementId,
  contentType,
  currentPhase,
  clientName,
  logs,
  currentUserId,
  title,
  requirementNotes,
  cambiosCount,
  reviewStartedAt,
  showMoveSection,
  priority: initialPriority = 'media',
  estimatedTimeMinutes: initialEstimatedTime = null,
  assignedTo: initialAssignedTo = null,
  assigneeName: initialAssigneeName = null,
  canAssign = false,
}: PhaseSheetProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>('fases')

  // Phase-move state
  const [toPhase, setToPhase] = useState<Phase>(currentPhase)
  const [moveNotes, setMoveNotes] = useState('')
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)

  // Edit requirement state
  const [editTitle, setEditTitle] = useState(title)
  const [editNotes, setEditNotes] = useState(requirementNotes ?? '')
  const [editPriority, setEditPriority] = useState<Priority>(initialPriority)
  const [editEstimatedTime, setEditEstimatedTime] = useState(initialEstimatedTime?.toString() ?? '')
  const [editAssignedTo, setEditAssignedTo] = useState(initialAssignedTo ?? '')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [assignableUsers, setAssignableUsers] = useState<{ id: string; full_name: string }[]>([])

  // Cambios
  const [localCambios, setLocalCambios] = useState(cambiosCount)
  const [incrementing, setIncrementing] = useState(false)

  // Passive timer (counts up while in any passive_timer phase)
  const [reviewElapsed, setReviewElapsed] = useState('')
  const isPassiveTimer = isPassiveTimerPhase(currentPhase)

  // Timer start: revision_cliente uses reviewStartedAt; other passive phases use last log
  const passiveTimerStart = !isPassiveTimer ? null
    : currentPhase === 'revision_cliente' ? reviewStartedAt
    : (logs[logs.length - 1]?.created_at ?? null)

  const passiveTimerLabel: Record<string, string> = {
    pendiente: 'En espera',
    pausa: 'En pausa',
    revision_cliente: 'Esperando respuesta del cliente',
  }

  useEffect(() => {
    if (!isPassiveTimer || !passiveTimerStart) {
      setReviewElapsed('')
      return
    }
    function tick() {
      const diff = Date.now() - new Date(passiveTimerStart!).getTime()
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      setReviewElapsed(`${h}h ${m}m`)
    }
    tick()
    const id = setInterval(tick, 60000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPhase, passiveTimerStart])

  // Fetch assignable users when canAssign
  useEffect(() => {
    if (!canAssign) return
    const supabase = createClient()
    supabase.from('users').select('id, full_name').then(({ data }) => {
      setAssignableUsers(data ?? [])
    })
  }, [canAssign])

  // Reset tab when sheet closes/opens
  useEffect(() => {
    if (open) {
      setActiveTab('fases')
      setToPhase(currentPhase)
      setMoveNotes('')
      setMoveError(null)
      setEditTitle(title)
      setEditNotes(requirementNotes ?? '')
      setEditPriority(initialPriority)
      setEditEstimatedTime(initialEstimatedTime?.toString() ?? '')
      setEditAssignedTo(initialAssignedTo ?? '')
      setLocalCambios(cambiosCount)
    }
  }, [open, currentPhase, title, requirementNotes, cambiosCount, initialPriority, initialEstimatedTime, initialAssignedTo])

  async function handleMove() {
    if (toPhase === currentPhase) {
      setMoveError('Selecciona una fase diferente a la actual.')
      return
    }
    setMoveError(null)
    setMoving(true)
    const supabase = createClient()
    const { error } = await movePhase(supabase, {
      requirementId,
      currentPhase,
      contentType,
      toPhase,
      movedBy: currentUserId,
      notes: moveNotes,
    })
    setMoving(false)
    if (error) { setMoveError(error); return }
    setMoveNotes('')
    onClose()
    router.refresh()
  }

  async function handleSaveEdit() {
    if (!editTitle.trim()) {
      setEditError('El título no puede estar vacío.')
      return
    }
    setEditError(null)
    setSavingEdit(true)
    const estMins = editEstimatedTime.trim() ? parseInt(editEstimatedTime.trim(), 10) : null
    const supabase = createClient()
    const { error } = await supabase
      .from('requirements')
      .update({
        title: editTitle.trim(),
        notes: editNotes.trim() || null,
        priority: editPriority,
        estimated_time_minutes: estMins && !isNaN(estMins) ? estMins : null,
        assigned_to: canAssign ? (editAssignedTo || null) : undefined,
      })
      .eq('id', requirementId)
    setSavingEdit(false)
    if (error) { setEditError('Error al guardar.'); return }
    onClose()
    router.refresh()
  }

  async function handleAddCambio() {
    setIncrementing(true)
    const supabase = createClient()
    await supabase
      .from('requirements')
      .update({ cambios_count: localCambios + 1 })
      .eq('id', requirementId)
    setLocalCambios((n) => n + 1)
    setIncrementing(false)
    router.refresh()
  }

  const showMove = showMoveSection ?? true

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0 gap-0 overflow-hidden">

        {/* ── Header (fixed) ── */}
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-[#dfe3e6] pr-14 flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-[#00675c]/10 text-[#00675c]">
              {CONTENT_TYPE_LABELS[contentType]}
            </span>
            <span
              className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                isPassiveTimer
                  ? 'bg-amber-100 text-amber-700'
                  : PHASE_CATEGORY[currentPhase] === 'timestamp_only'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-[#f5f7f9] text-[#595c5e]'
              }`}
            >
              {PHASE_LABELS[currentPhase]}
            </span>
            {isPassiveTimer && reviewElapsed && (
              <span className="text-xs font-bold text-amber-700 flex items-center gap-1">
                <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current">
                  <path d="M6 2v6l2 2-2 2v6h12v-6l-2-2 2-2V2H6zm10 14.5V20H8v-3.5l4-4 4 4zm-4-5l-4-4V4h8v3.5l-4 4z"/>
                </svg>
                {reviewElapsed}
              </span>
            )}
          </div>
          <SheetTitle className="text-sm font-semibold text-[#2c2f31] leading-snug mt-1 line-clamp-2">
            {title || CONTENT_TYPE_LABELS[contentType]}
          </SheetTitle>
          <p className="text-xs text-[#747779]">{clientName}</p>
        </SheetHeader>

        {/* ── Tabs (fixed) ── */}
        <div className="flex border-b border-[#dfe3e6] flex-shrink-0 bg-white">
          {([
            { id: 'fases', icon: (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                <path d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z"/>
              </svg>
            ), label: 'Fases' },
            { id: 'chat', icon: (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
              </svg>
            ), label: 'Chat' },
            { id: 'tiempo', icon: (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                <path d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61l1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42C16.07 4.74 14.12 4 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
              </svg>
            ), label: 'Hoja de tiempo' },
          ] as { id: Tab; icon: React.ReactNode; label: string }[]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors flex-1 justify-center ${
                activeTab === tab.id
                  ? 'text-[#00675c] border-[#00675c]'
                  : 'text-[#747779] border-transparent hover:text-[#2c2f31]'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Tab content (scrollable) ── */}
        <div className="flex-1 min-h-0 overflow-hidden">

          {/* FASES */}
          <div className={`h-full overflow-y-auto ${activeTab === 'fases' ? 'block' : 'hidden'}`}>
            <div className="px-5 py-4 space-y-5">

              {/* Edit title/notes */}
              <div className="space-y-3 pb-4 border-b border-[#eef1f3]">
                <p className="text-[10px] font-bold text-[#abadaf] uppercase tracking-wider">
                  Información del requerimiento
                </p>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-[#595c5e]">Título</Label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl focus:outline-none focus:border-[#00675c] text-[#2c2f31]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-[#595c5e]">
                    Notas <span className="text-[#abadaf] font-normal">(opcional)</span>
                  </Label>
                  <Textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Instrucciones, descripción del contenido…"
                    className="resize-none bg-[#f5f7f9] border-[#dfe3e6] focus:border-[#00675c] rounded-xl text-sm"
                    rows={2}
                  />
                </div>
                {/* Priority */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-[#595c5e]">Prioridad</Label>
                  <div className="flex gap-1.5">
                    {(['baja', 'media', 'alta'] as Priority[]).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setEditPriority(p)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold border-2 transition-all flex items-center justify-center gap-1 ${
                          editPriority === p ? 'border-current' : 'border-[#dfe3e6] text-[#595c5e]'
                        }`}
                        style={editPriority === p ? { color: PRIORITY_COLORS[p], background: PRIORITY_COLORS[p] + '15' } : {}}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: PRIORITY_COLORS[p] }} />
                        {PRIORITY_LABELS[p]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Estimated time */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-[#595c5e]">
                    Tiempo estimado <span className="text-[#abadaf] font-normal">(min)</span>
                  </Label>
                  <input
                    type="number"
                    min="1"
                    value={editEstimatedTime}
                    onChange={(e) => setEditEstimatedTime(e.target.value)}
                    placeholder="ej. 90"
                    className="w-full px-3 py-2 text-sm bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl focus:outline-none focus:border-[#00675c] text-[#2c2f31]"
                  />
                </div>

                {/* Assignee */}
                {canAssign && assignableUsers.length > 0 && (
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-[#595c5e]">Asignado a</Label>
                    <select
                      value={editAssignedTo}
                      onChange={(e) => setEditAssignedTo(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl outline-none focus:border-[#00675c] text-[#2c2f31]"
                    >
                      <option value="">Sin asignar</option>
                      {assignableUsers.map((u) => (
                        <option key={u.id} value={u.id}>{u.full_name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Read-only assignee display for operators */}
                {!canAssign && initialAssigneeName && (
                  <div className="flex items-center gap-2 bg-[#f5f7f9] rounded-xl px-3 py-2">
                    <span className="w-6 h-6 rounded-full bg-[#00675c]/15 flex items-center justify-center text-[9px] font-bold text-[#00675c]">
                      {initialAssigneeName.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                    </span>
                    <div>
                      <p className="text-[10px] text-[#abadaf] font-semibold uppercase tracking-wide">Asignado a</p>
                      <p className="text-xs font-semibold text-[#2c2f31]">{initialAssigneeName}</p>
                    </div>
                  </div>
                )}

                {editError && (
                  <p className="text-xs text-[#b31b25] bg-[#b31b25]/5 rounded-lg px-3 py-1.5 border border-[#b31b25]/20">
                    {editError}
                  </p>
                )}
                <button
                  onClick={handleSaveEdit}
                  disabled={savingEdit || !editTitle.trim()}
                  className="w-full py-2 text-sm font-semibold rounded-xl text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#00675c,#5bf4de)' }}
                >
                  {savingEdit ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>

              {/* Passive timer — all passive_timer phases */}
              {isPassiveTimer && (
                <div className="rounded-2xl p-4 border border-[#f59e0b]/30 bg-amber-50">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-1.5 mb-1">
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-amber-600">
                          <path d="M6 2v6l2 2-2 2v6h12v-6l-2-2 2-2V2H6zm10 14.5V20H8v-3.5l4-4 4 4zm-4-5l-4-4V4h8v3.5l-4 4z"/>
                        </svg>
                        <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">
                          {passiveTimerLabel[currentPhase] ?? 'Tiempo automático'}
                        </span>
                        <span className="text-[9px] font-bold bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full">
                          AUTO
                        </span>
                      </div>
                      <p className="text-2xl font-black text-amber-700 tabular-nums">
                        {reviewElapsed || '—'}
                      </p>
                      {passiveTimerStart && (
                        <p className="text-xs text-amber-600 mt-0.5">
                          Desde {new Date(passiveTimerStart).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Cambios */}
              <div className="flex items-center justify-between bg-[#f5f7f9] rounded-xl px-4 py-3">
                <div>
                  <p className="text-xs text-[#595c5e] font-semibold">Cambios aplicados</p>
                  <p className="text-[10px] text-[#abadaf] mt-0.5">se suman al total del ciclo</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-black text-[#2c2f31]">{localCambios}</span>
                  <button
                    onClick={handleAddCambio}
                    disabled={incrementing}
                    className="text-xs font-bold px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 bg-[#00675c]/10 text-[#00675c] hover:bg-[#00675c]/20"
                  >
                    {incrementing ? '…' : '+1'}
                  </button>
                </div>
              </div>

              {/* Timeline */}
              <div>
                <p className="text-[10px] font-bold text-[#abadaf] uppercase tracking-wider mb-3">
                  Historial de fases
                </p>
                {logs.length === 0 ? (
                  <p className="text-sm text-[#abadaf] italic">Sin movimientos registrados.</p>
                ) : (
                  <ol className="space-y-0">
                    {logs.map((log, idx) => (
                      <li key={log.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1"
                            style={{
                              background: isPassiveTimerPhase(log.to_phase as Phase) ? '#f59e0b'
                                : PHASE_CATEGORY[log.to_phase as Phase] === 'timestamp_only' ? '#22c55e'
                                : '#00675c',
                            }}
                          />
                          {idx < logs.length - 1 && (
                            <div className="w-px flex-1 bg-[#eef1f3] my-1" />
                          )}
                        </div>
                        <div className="pb-4 min-w-0">
                          <p className="text-[11px] text-[#abadaf] mb-0.5">
                            {new Date(log.created_at).toLocaleDateString('es', {
                              day: '2-digit', month: 'short', year: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </p>
                          <p className="text-sm font-semibold text-[#2c2f31]">
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

              {/* Move phase form */}
              {showMove && (
                <div className="space-y-3 border-t border-[#eef1f3] pt-4">
                  <p className="text-[10px] font-bold text-[#abadaf] uppercase tracking-wider">
                    Mover a fase
                  </p>
                  <Select value={toPhase} onValueChange={(v) => setToPhase(v as Phase)}>
                    <SelectTrigger className="rounded-xl border-[#dfe3e6] bg-white h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PHASES.map((phase) => (
                        <SelectItem key={phase} value={phase}>
                          {PHASE_LABELS[phase]}{phase === currentPhase ? ' (actual)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Textarea
                    value={moveNotes}
                    onChange={(e) => setMoveNotes(e.target.value)}
                    placeholder="Notas del movimiento (opcional)"
                    className="resize-none bg-[#f5f7f9] border-[#dfe3e6] focus:border-[#00675c] rounded-xl text-sm"
                    rows={2}
                  />
                  {moveError && (
                    <p className="text-sm text-[#b31b25] bg-[#b31b25]/5 rounded-xl px-3 py-2 border border-[#b31b25]/20">
                      {moveError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* CHAT */}
          <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
            <RequirementChat
              requirementId={requirementId}
              currentUserId={currentUserId}
            />
          </div>

          {/* HOJA DE TIEMPO */}
          <div className={`h-full overflow-hidden ${activeTab === 'tiempo' ? 'block' : 'hidden'}`}>
            <RequirementTimesheet
              requirementId={requirementId}
              currentPhase={currentPhase}
              currentUserId={currentUserId}
            />
          </div>
        </div>

        {/* ── Footer (fixed) ── */}
        {activeTab === 'fases' && showMove ? (
          <div className="px-5 py-3 border-t border-[#dfe3e6] bg-white flex gap-2 flex-shrink-0">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 rounded-xl border-[#dfe3e6] text-[#595c5e] h-9 text-sm"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleMove}
              disabled={moving || toPhase === currentPhase}
              className="flex-1 rounded-xl text-white font-semibold h-9 text-sm"
              style={{ background: 'linear-gradient(135deg,#00675c,#5bf4de)' }}
            >
              {moving ? 'Moviendo…' : 'Mover fase'}
            </Button>
          </div>
        ) : (
          <div className="px-5 py-3 border-t border-[#dfe3e6] bg-white flex-shrink-0">
            <Button
              variant="outline"
              onClick={onClose}
              className="w-full rounded-xl h-9 text-sm"
            >
              Cerrar
            </Button>
          </div>
        )}

      </SheetContent>
    </Sheet>
  )
}
