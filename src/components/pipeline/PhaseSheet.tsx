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
import { PHASES, PHASE_LABELS, PHASE_CATEGORY, isPassiveTimerPhase, isUserTrackedPhase } from '@/lib/domain/pipeline'
import { movePhase } from '@/lib/domain/pipeline'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import type { Phase, ContentType, RequirementPhaseLog, RequirementCambioLog, Priority } from '@/types/db'
import { PRIORITY_LABELS, PRIORITY_COLORS } from '@/types/db'
import { RequirementChat } from './RequirementChat'
import { RequirementTimesheet } from './RequirementTimesheet'
import { ShareRequirementDialog } from './ShareRequirementDialog'
import { ContentReviewDialog } from '@/components/clients/review/ContentReviewDialog'

type Tab = 'fases' | 'chat' | 'tiempo'

/** "1h 30m" / "35m" / "45s" — compacto para el historial de fases */
function formatSecondsShort(secs: number): string {
  if (secs <= 0) return '0m'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return `${m}m`
  return `${s}s`
}

interface PhaseSheetProps {
  open: boolean
  onClose: () => void
  requirementId: string
  contentType: ContentType
  currentPhase: Phase
  clientName: string
  clientId?: string
  logs: Array<RequirementPhaseLog & { moved_by_user?: { id: string; full_name: string | null; avatar_url: string | null } | null }>
  currentUserId: string
  title: string
  requirementNotes: string | null
  cambiosCount: number
  reviewStartedAt: string | null
  showMoveSection?: boolean
  priority?: Priority
  estimatedTimeMinutes?: number | null
  assignedTo?: string[] | null
  assignees?: { id: string; name: string; avatar_url: string | null }[]
  canAssign?: boolean
  includesStory?: boolean
  deadline?: string | null
  isAdmin?: boolean
  initialReviewOpen?: boolean
  initialReviewPinId?: string | null
}

export function PhaseSheet({
  open,
  onClose,
  requirementId,
  contentType,
  currentPhase,
  clientName,
  clientId,
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
  assignees: initialAssignees = [],
  canAssign = false,
  includesStory: initialIncludesStory = false,
  deadline: initialDeadline = null,
  isAdmin = false,
  initialReviewOpen = false,
  initialReviewPinId = null,
}: PhaseSheetProps) {
  const STORY_APPLICABLE_TYPES: ContentType[] = ['estatico', 'video_corto', 'reel', 'short']
  const storyApplicable = STORY_APPLICABLE_TYPES.includes(contentType)
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>('fases')
  const [reviewOpen, setReviewOpen] = useState<boolean>(initialReviewOpen)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialReviewOpen) setReviewOpen(true)
  }, [initialReviewOpen])

  // Expand state (desktop only)
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem('phasesheet-expanded') === '1'
    } catch { return false }
  })
  function toggleExpanded() {
    setExpanded((v) => {
      const next = !v
      try {
        window.localStorage.setItem('phasesheet-expanded', next ? '1' : '0')
      } catch {}
      return next
    })
  }

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
  const [editAssignedTo, setEditAssignedTo] = useState<string[]>(initialAssignedTo ?? [])
  const [editIncludesStory, setEditIncludesStory] = useState(initialIncludesStory)
  const [editDeadline, setEditDeadline] = useState(initialDeadline ?? '')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [assignableUsers, setAssignableUsers] = useState<{ id: string; full_name: string }[]>([])

  // Cambios
  const [localCambios, setLocalCambios] = useState(cambiosCount)
  const [incrementing, setIncrementing] = useState(false)
  const [showCambioForm, setShowCambioForm] = useState(false)
  const [cambioNote, setCambioNote] = useState('')
  const [cambioLogs, setCambioLogs] = useState<RequirementCambioLog[]>([])

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

  // `revision_cliente` conserva el box visible (timestamp de inicio) pero sin
  // contador en vivo — el tracking "stand-by vs trabajado" no aplica cuando la
  // pelota está del lado del cliente.
  const showLiveCounter = isPassiveTimer && currentPhase !== 'revision_cliente'

  useEffect(() => {
    if (!showLiveCounter || !passiveTimerStart) return
    function tick() {
      const diff = new Date().getTime() - new Date(passiveTimerStart!).getTime()
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      setReviewElapsed(`${h}h ${m}m`)
    }
    tick()
    const id = setInterval(tick, 60000)
    return () => { clearInterval(id); setReviewElapsed('') }
  }, [currentPhase, passiveTimerStart, showLiveCounter])

  // Productive-phase elapsed timer — shows how long req has been in the current
  // user_tracked phase (from the most-recent log whose to_phase === currentPhase)
  const [phaseElapsedStr, setPhaseElapsedStr] = useState('')
  const isUserTracked = isUserTrackedPhase(currentPhase)
  const currentPhaseLogStart = isUserTracked
    ? ([...logs].reverse().find(l => l.to_phase === currentPhase)?.created_at ?? null)
    : null

  useEffect(() => {
    if (!currentPhaseLogStart) return
    function tickPhase() {
      const diff = new Date().getTime() - new Date(currentPhaseLogStart!).getTime()
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      setPhaseElapsedStr(h > 0 ? `${h}h ${m}m` : `${m}m`)
    }
    tickPhase()
    const id = setInterval(tickPhase, 60000)
    return () => { clearInterval(id); setPhaseElapsedStr('') }
  }, [currentPhase, currentPhaseLogStart])

  // Fetch assignable users when canAssign
  useEffect(() => {
    if (!canAssign) return
    const supabase = createClient()
    supabase.from('users').select('id, full_name').not('role', 'eq', 'client').then(({ data }) => {
      setAssignableUsers(data ?? [])
    })
  }, [canAssign])

  // Load cambio logs when sheet opens
  useEffect(() => {
    if (!open) return
    const supabase = createClient()
    supabase
      .from('requirement_cambio_logs')
      .select('*')
      .eq('requirement_id', requirementId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setCambioLogs(data ?? []))
  }, [open, requirementId])

  // Reset tab when sheet closes/opens
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab('fases')
      setToPhase(currentPhase)
      setMoveNotes('')
      setMoveError(null)
      setEditTitle(title)
      setEditNotes(requirementNotes ?? '')
      setEditPriority(initialPriority)
      setEditEstimatedTime(initialEstimatedTime?.toString() ?? '')
      setEditAssignedTo(initialAssignedTo ?? [])
      setEditIncludesStory(initialIncludesStory)
      setEditDeadline(initialDeadline ?? '')
      setLocalCambios(cambiosCount)
      setShowCambioForm(false)
      setCambioNote('')
    }
  }, [open, currentPhase, title, requirementNotes, cambiosCount, initialPriority, initialEstimatedTime, initialAssignedTo, initialIncludesStory, initialDeadline])

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
        assigned_to: canAssign ? (editAssignedTo.length > 0 ? editAssignedTo : null) : undefined,
        includes_story: storyApplicable ? editIncludesStory : false,
        deadline: editDeadline.trim() || null,
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
    const { data: { user } } = await supabase.auth.getUser()
    const note = cambioNote.trim() || null

    await Promise.all([
      supabase.from('requirements').update({ cambios_count: localCambios + 1 }).eq('id', requirementId),
      supabase.from('requirement_cambio_logs').insert({
        requirement_id: requirementId,
        notes: note,
        created_by: user?.id ?? null,
      }),
    ])

    const newLog: RequirementCambioLog = {
      id: crypto.randomUUID(),
      requirement_id: requirementId,
      notes: note,
      created_by: user?.id ?? null,
      created_at: new Date().toISOString(),
    }
    setCambioLogs(prev => [newLog, ...prev])
    setLocalCambios((n) => n + 1)
    setShowCambioForm(false)
    setCambioNote('')
    setIncrementing(false)
    router.refresh()
  }

  const showMove = showMoveSection ?? true

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent
        fullScreenOnMobile
        className={`w-full flex flex-col p-0 gap-0 overflow-hidden transition-[max-width,width] duration-200 ${
          expanded
            ? 'sm:!w-[66vw] sm:!max-w-[66vw]'
            : 'sm:!max-w-md'
        }`}
      >

        {/* Expand/collapse button — solo desktop */}
        <button
          type="button"
          onClick={toggleExpanded}
          className="hidden sm:inline-flex absolute top-3 right-20 z-10 items-center justify-center w-8 h-8 rounded-md text-fm-on-surface-variant hover:bg-fm-background"
          title={expanded ? 'Contraer' : 'Expandir'}
          aria-label={expanded ? 'Contraer panel' : 'Expandir panel'}
        >
          <span className="material-symbols-outlined text-[20px]">
            {expanded ? 'close_fullscreen' : 'open_in_full'}
          </span>
        </button>

        {/* Share button — posicionado junto al botón de cerrar */}
        <div className="absolute top-3 right-12 z-10">
          <ShareRequirementDialog
            requirementId={requirementId}
            requirementTitle={title || CONTENT_TYPE_LABELS[contentType]}
            trigger={
              <span
                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-fm-on-surface-variant hover:bg-fm-background cursor-pointer"
                title="Compartir requerimiento"
              >
                <span className="material-symbols-outlined text-[20px]">share</span>
              </span>
            }
          />
        </div>

        {/* ── Header (fixed) ── */}
        <SheetHeader className="px-5 pt-5 pb-3 border-b border-fm-surface-container-high pr-24 sm:pr-32 flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-fm-primary/10 text-fm-primary">
              {CONTENT_TYPE_LABELS[contentType]}
            </span>
            <span
              className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                isPassiveTimer
                  ? 'bg-amber-100 text-amber-700'
                  : PHASE_CATEGORY[currentPhase] === 'timestamp_only'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-fm-background text-fm-on-surface-variant'
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
          <SheetTitle className="text-sm font-semibold text-fm-on-surface leading-snug mt-1 line-clamp-2">
            {title || CONTENT_TYPE_LABELS[contentType]}
          </SheetTitle>
          <p className="text-xs text-fm-outline">{clientName}</p>
        </SheetHeader>

        {/* ── Tabs (fixed) ── */}
        <div className="flex border-b border-fm-surface-container-high flex-shrink-0 bg-fm-surface-container-lowest">
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
                  ? 'text-fm-primary border-fm-primary'
                  : 'text-fm-outline border-transparent hover:text-fm-on-surface'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
          {clientId && (
            <button
              onClick={() => setReviewOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold border-b-2 border-transparent text-fm-outline hover:text-fm-on-surface transition-colors flex-1 justify-center"
              title="Abrir revisión de contenido"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">
                <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
              </svg>
              Revisión
            </button>
          )}
        </div>

        {/* ── Tab content (scrollable) ── */}
        <div className="flex-1 min-h-0 overflow-hidden">

          {/* FASES */}
          <div className={`h-full overflow-y-auto ${activeTab === 'fases' ? 'block' : 'hidden'}`}>
            <div className="px-5 py-4 space-y-5">

              {/* Edit title/notes */}
              <div className="space-y-3 pb-4 border-b border-fm-surface-container-low">
                <p className="text-[10px] font-bold text-fm-outline-variant uppercase tracking-wider">
                  Información del requerimiento
                </p>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-fm-on-surface-variant">Título</Label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl focus:outline-none focus:border-fm-primary text-fm-on-surface"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-fm-on-surface-variant">
                    Notas <span className="text-fm-outline-variant font-normal">(opcional)</span>
                  </Label>
                  <Textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Instrucciones, descripción del contenido…"
                    className="resize-none bg-fm-background border-fm-surface-container-high focus:border-fm-primary rounded-xl text-sm"
                    rows={2}
                  />
                </div>
                {/* Priority */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-fm-on-surface-variant">Prioridad</Label>
                  <div className="flex gap-1.5">
                    {(['baja', 'media', 'alta'] as Priority[]).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setEditPriority(p)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold border-2 transition-all flex items-center justify-center gap-1 ${
                          editPriority === p ? 'border-current' : 'border-fm-surface-container-high text-fm-on-surface-variant'
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
                  <Label className="text-xs font-semibold text-fm-on-surface-variant">
                    Tiempo estimado <span className="text-fm-outline-variant font-normal">(min)</span>
                  </Label>
                  <input
                    type="number"
                    min="1"
                    value={editEstimatedTime}
                    onChange={(e) => setEditEstimatedTime(e.target.value)}
                    placeholder="ej. 90"
                    className="w-full px-3 py-2 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl focus:outline-none focus:border-fm-primary text-fm-on-surface"
                  />
                </div>

                {/* Deadline */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-fm-on-surface-variant">
                    Fecha de entrega <span className="text-fm-outline-variant font-normal">(opcional)</span>
                  </Label>
                  <input
                    type="date"
                    value={editDeadline}
                    onChange={(e) => setEditDeadline(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl focus:outline-none focus:border-fm-primary text-fm-on-surface"
                  />
                </div>

                {/* Includes story — solo para tipos aplicables */}
                {storyApplicable && (
                  <div className="flex items-start gap-3 p-3 bg-fm-background rounded-xl border border-fm-surface-container-high">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={editIncludesStory}
                      onClick={() => setEditIncludesStory(!editIncludesStory)}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors mt-0.5 ${
                        editIncludesStory ? 'bg-fm-primary' : 'bg-fm-outline-variant'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-fm-surface-container-lowest shadow transition-transform ${
                          editIncludesStory ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-fm-on-surface">Incluye story</p>
                      <p className="text-[11px] text-fm-outline mt-0.5 leading-snug">
                        Suma 1 a historias del ciclo sin crear un requerimiento aparte.
                      </p>
                    </div>
                  </div>
                )}

                {/* Assignees — multi-select checkboxes for admin/supervisor */}
                {canAssign && assignableUsers.length > 0 && (
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-fm-on-surface-variant">Asignado a</Label>
                    <div className="bg-fm-background border border-fm-surface-container-high rounded-xl px-3 py-2 space-y-1.5 max-h-36 overflow-y-auto">
                      {assignableUsers.map((u) => {
                        const checked = editAssignedTo.includes(u.id)
                        return (
                          <label key={u.id} className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setEditAssignedTo(prev =>
                                checked ? prev.filter(id => id !== u.id) : [...prev, u.id]
                              )}
                              className="rounded accent-fm-primary"
                            />
                            <span className="text-sm text-fm-on-surface">{u.full_name}</span>
                          </label>
                        )
                      })}
                    </div>
                    {editAssignedTo.length === 0 && (
                      <p className="text-[10px] text-fm-outline-variant">Sin asignar</p>
                    )}
                  </div>
                )}

                {/* Read-only assignee display for operators */}
                {!canAssign && initialAssignees.length > 0 && (
                  <div className="bg-fm-background rounded-xl px-3 py-2 space-y-1.5">
                    <p className="text-[10px] text-fm-outline-variant font-semibold uppercase tracking-wide">Asignado a</p>
                    {initialAssignees.map((a) => (
                      <div key={a.id} className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-fm-primary/15 flex items-center justify-center text-[9px] font-bold text-fm-primary overflow-hidden flex-shrink-0">
                          {a.avatar_url ? (
                            <img src={a.avatar_url} alt={a.name} className="w-full h-full object-cover" />
                          ) : (
                            a.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
                          )}
                        </span>
                        <p className="text-xs font-semibold text-fm-on-surface">{a.name}</p>
                      </div>
                    ))}
                  </div>
                )}

                {editError && (
                  <p className="text-xs text-fm-error bg-fm-error/5 rounded-lg px-3 py-1.5 border border-fm-error/20">
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
                        {showLiveCounter && (
                          <span className="text-[9px] font-bold bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full">
                            AUTO
                          </span>
                        )}
                      </div>
                      {showLiveCounter ? (
                        <p className="text-2xl font-black text-amber-700 tabular-nums">
                          {reviewElapsed || '—'}
                        </p>
                      ) : (
                        <p className="text-sm font-semibold text-amber-700">
                          En espera del cliente
                        </p>
                      )}
                      {passiveTimerStart && (
                        <p className="text-xs text-amber-600 mt-0.5">
                          Desde {new Date(passiveTimerStart).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Productive-phase elapsed time */}
              {isUserTracked && currentPhaseLogStart && (
                <div className="rounded-2xl p-4 border border-fm-primary/25 bg-fm-primary/5">
                  <div className="flex items-start gap-2 mb-1">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-fm-primary flex-shrink-0 mt-0.5">
                      <path d="M15 1H9v2h6V1zm-4 13h2V8h-2v6zm8.03-6.61 1.42-1.42c-.43-.51-.9-.99-1.41-1.41l-1.42 1.42C16.07 4.74 14.12 4 12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9 9-4.03 9-9c0-2.12-.74-4.07-1.97-5.61zM12 20c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z"/>
                    </svg>
                    <span className="text-[10px] font-bold text-fm-primary uppercase tracking-wider">
                      Tiempo en esta fase
                    </span>
                  </div>
                  <p className="text-2xl font-black text-fm-primary tabular-nums">
                    {phaseElapsedStr || '—'}
                  </p>
                  <p className="text-xs text-fm-primary/60 mt-0.5">
                    Desde {new Date(currentPhaseLogStart).toLocaleDateString('es', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </p>
                </div>
              )}

              {/* Cambios */}
              <div className="bg-fm-background rounded-xl px-4 py-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-fm-on-surface-variant font-semibold">Cambios aplicados</p>
                    <p className="text-[10px] text-fm-outline-variant mt-0.5">se suman al total del ciclo</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-black text-fm-on-surface">{localCambios}</span>
                    <button
                      onClick={() => setShowCambioForm(v => !v)}
                      disabled={incrementing}
                      className="text-xs font-bold px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 bg-fm-primary/10 text-fm-primary hover:bg-fm-primary/20"
                    >
                      +1
                    </button>
                  </div>
                </div>

                {/* Inline form for new cambio */}
                {showCambioForm && (
                  <div className="space-y-2 pt-1 border-t border-fm-surface-container-high">
                    <Textarea
                      value={cambioNote}
                      onChange={e => setCambioNote(e.target.value)}
                      placeholder="Descripción del cambio (opcional)"
                      className="resize-none text-xs bg-fm-surface-container-lowest border-fm-surface-container-high focus:border-fm-primary rounded-lg"
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setShowCambioForm(false); setCambioNote('') }}
                        className="flex-1 py-1.5 text-xs font-semibold border border-fm-surface-container-high rounded-lg text-fm-on-surface-variant hover:bg-fm-surface-container-lowest"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleAddCambio}
                        disabled={incrementing}
                        className="flex-1 py-1.5 text-xs font-semibold rounded-lg text-white bg-fm-primary hover:bg-fm-primary-dim disabled:opacity-50"
                      >
                        {incrementing ? 'Registrando…' : 'Registrar cambio'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Past cambio logs */}
                {cambioLogs.length > 0 && (
                  <div className="pt-1 border-t border-fm-surface-container-high space-y-2">
                    {cambioLogs.map((log, i) => (
                      <div key={log.id} className="flex gap-2 items-start">
                        <span className="mt-1 w-1.5 h-1.5 rounded-full bg-fm-outline-variant flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[10px] text-fm-outline-variant">
                            Cambio {cambioLogs.length - i} ·{' '}
                            {new Date(log.created_at).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </p>
                          {log.notes ? (
                            <p className="text-xs text-fm-on-surface mt-0.5">{log.notes}</p>
                          ) : (
                            <p className="text-xs text-fm-outline-variant italic">Sin descripción</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Timeline */}
              <div>
                <p className="text-[10px] font-bold text-fm-outline-variant uppercase tracking-wider mb-3">
                  Historial de fases
                </p>
                {logs.length === 0 ? (
                  <p className="text-sm text-fm-outline-variant italic">Sin movimientos registrados.</p>
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
                            <div className="w-px flex-1 bg-fm-surface-container-low my-1" />
                          )}
                        </div>
                        <div className="pb-4 min-w-0">
                          <p className="text-[11px] text-fm-outline-variant mb-0.5">
                            {new Date(log.created_at).toLocaleDateString('es', {
                              day: '2-digit', month: 'short', year: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })}
                            {log.ended_at && (
                              <>
                                {' · salió '}
                                {new Date(log.ended_at).toLocaleDateString('es', {
                                  day: '2-digit', month: 'short',
                                  hour: '2-digit', minute: '2-digit',
                                })}
                              </>
                            )}
                          </p>
                          <p className="text-sm font-semibold text-fm-on-surface">
                            {log.from_phase
                              ? `${PHASE_LABELS[log.from_phase as Phase]} → ${PHASE_LABELS[log.to_phase as Phase]}`
                              : `Creado en ${PHASE_LABELS[log.to_phase as Phase]}`}
                          </p>
                          <p className="text-[11px] text-fm-on-surface-variant mt-0.5">
                            por {log.moved_by_user?.full_name ?? '—'}
                          </p>
                          {log.ended_at && (log.standby_seconds != null || log.worked_seconds != null) && (
                            <p className="text-[11px] text-fm-on-surface-variant mt-1">
                              <span className="text-amber-700 font-semibold">
                                Stand-by: {formatSecondsShort(log.standby_seconds ?? 0)}
                              </span>
                              {' · '}
                              <span className="text-fm-primary font-semibold">
                                Trabajado: {formatSecondsShort(log.worked_seconds ?? 0)}
                              </span>
                            </p>
                          )}
                          {log.notes && (
                            <p className="text-xs text-fm-on-surface-variant mt-1 bg-fm-background rounded-lg px-2.5 py-1.5">
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
                <div className="space-y-3 border-t border-fm-surface-container-low pt-4">
                  <p className="text-[10px] font-bold text-fm-outline-variant uppercase tracking-wider">
                    Mover a fase
                  </p>
                  <Select value={toPhase} onValueChange={(v) => setToPhase(v as Phase)}>
                    <SelectTrigger className="rounded-xl border-fm-surface-container-high bg-fm-surface-container-lowest h-10">
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
                    className="resize-none bg-fm-background border-fm-surface-container-high focus:border-fm-primary rounded-xl text-sm"
                    rows={2}
                  />
                  {moveError && (
                    <p className="text-sm text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">
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
              isAdmin={isAdmin}
            />
          </div>

          {/* HOJA DE TIEMPO */}
          <div className={`h-full overflow-hidden ${activeTab === 'tiempo' ? 'block' : 'hidden'}`}>
            <RequirementTimesheet
              requirementId={requirementId}
              currentPhase={currentPhase}
              currentUserId={currentUserId}
              canAssignToOthers={canAssign}
            />
          </div>
        </div>

        {/* ── Footer (fixed) ── */}
        {activeTab === 'fases' && showMove ? (
          <div className="px-5 py-3 border-t border-fm-surface-container-high bg-fm-surface-container-lowest flex gap-2 flex-shrink-0">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 rounded-xl border-fm-surface-container-high text-fm-on-surface-variant h-9 text-sm"
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
          <div className="px-5 py-3 border-t border-fm-surface-container-high bg-fm-surface-container-lowest flex-shrink-0">
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
      {clientId && (
        <ContentReviewDialog
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          requirementId={requirementId}
          clientId={clientId}
          requirementTitle={title || CONTENT_TYPE_LABELS[contentType]}
          currentUserId={currentUserId}
          initialPinId={initialReviewPinId}
        />
      )}
    </Sheet>
  )
}
