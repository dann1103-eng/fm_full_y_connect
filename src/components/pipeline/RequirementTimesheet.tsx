'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { adminAddEntry } from '@/app/actions/time'
import type { Phase } from '@/types/db'
import { PHASE_LABELS, PHASES, isUserTrackedPhase, isPassiveTimerPhase } from '@/lib/domain/pipeline'
import { UserAvatar } from '@/components/ui/UserAvatar'

interface TimeEntryRow {
  id: string
  title: string
  phase: string
  duration_seconds: number | null
  started_at: string
  ended_at: string | null
  user_id: string
  user: { full_name: string; avatar_url: string | null } | null
}

interface ActiveTimer {
  entryId: string
  startedAt: number // epoch ms
  title: string
  phase: string
}

const TIMER_KEY = (reqId: string, userId: string) => `fm_crm_timer_${reqId}_${userId}`

const USER_TRACKED_PHASES = PHASES.filter(isUserTrackedPhase)

/** Convierte un valor de input datetime-local (sin zona horaria) a ISO UTC.
 *  El browser parsea strings sin TZ como hora local → toISOString() da UTC correcto. */
function localInputToUtc(localStr: string): string {
  return new Date(localStr).toISOString()
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0 && s > 0) return `${m}m ${s}s`
  if (m > 0) return `${m}m`
  return `${s}s`
}

function formatClock(seconds: number): string {
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0')
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
  const s = String(seconds % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

interface RequirementTimesheetProps {
  requirementId: string
  currentPhase: Phase
  currentUserId: string
  canAssignToOthers?: boolean
}

export function RequirementTimesheet({
  requirementId,
  currentPhase,
  currentUserId,
  canAssignToOthers = false,
}: RequirementTimesheetProps) {
  const [entries, setEntries] = useState<TimeEntryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [newTitle, setNewTitle] = useState('')
  const [newPhase, setNewPhase] = useState<string>(
    isUserTrackedPhase(currentPhase) ? currentPhase : 'proceso_edicion'
  )
  const [manualStartedAt, setManualStartedAt] = useState('')
  const [manualEndedAt, setManualEndedAt] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [saving, setSaving] = useState(false)
  const [titleError, setTitleError] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)
  const [globalActiveWarning, setGlobalActiveWarning] = useState<string | null>(null)
  // Admin/supervisor: elegir a quién se asigna la entrada manual
  const [manualTargetUserId, setManualTargetUserId] = useState<string>(currentUserId)
  const [assignableUsers, setAssignableUsers] = useState<{ id: string; full_name: string }[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const canTrackTime = isUserTrackedPhase(currentPhase)
  const isPassiveTimer = isPassiveTimerPhase(currentPhase)

  useEffect(() => {
    loadEntries()
    checkGlobalActive()
    // Restore active timer from localStorage
    const stored = localStorage.getItem(TIMER_KEY(requirementId, currentUserId))
    if (stored) {
      try {
        const parsed: ActiveTimer = JSON.parse(stored)
        setActiveTimer(parsed)
        setElapsed(Math.floor((Date.now() - parsed.startedAt) / 1000))
      } catch {
        localStorage.removeItem(TIMER_KEY(requirementId, currentUserId))
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirementId])

  // Fetch assignable users when admin/supervisor
  useEffect(() => {
    if (!canAssignToOthers) return
    const supabase = createClient()
    supabase
      .from('users')
      .select('id, full_name')
      .order('full_name')
      .then(({ data }) => setAssignableUsers(data ?? []))
  }, [canAssignToOthers])

  async function checkGlobalActive() {
    const supabase = createClient()
    const { data } = await supabase
      .from('time_entries')
      .select('id, title, entry_type, requirement_id')
      .eq('user_id', currentUserId)
      .is('ended_at', null)
      .maybeSingle()
    if (data && data.requirement_id !== requirementId) {
      const label = data.entry_type === 'administrative' ? 'una tarea administrativa' : `otro requerimiento`
      setGlobalActiveWarning(`Tienes un timer activo en ${label}. Detenlo primero para registrar tiempo aquí.`)
    } else {
      setGlobalActiveWarning(null)
    }
  }

  useEffect(() => {
    if (activeTimer) {
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - activeTimer.startedAt) / 1000))
      }, 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [activeTimer])

  async function loadEntries() {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('time_entries')
      .select('id, title, phase, duration_seconds, started_at, ended_at, user_id, user:users(full_name, avatar_url)')
      .eq('requirement_id', requirementId)
      .not('ended_at', 'is', null)  // only completed entries in list
      .order('created_at', { ascending: false })
    setEntries((data ?? []) as TimeEntryRow[])
    setLoading(false)
  }

  async function startTimer() {
    if (!newTitle.trim()) { setTitleError(true); return }
    setTitleError(false)
    setSaving(true)
    const supabase = createClient()
    const startedAt = new Date().toISOString()
    const { data: inserted, error } = await supabase
      .from('time_entries')
      .insert({
        requirement_id: requirementId,
        entry_type: 'requirement',
        user_id: currentUserId,
        phase: newPhase,
        title: newTitle.trim(),
        started_at: startedAt,
      })
      .select('id')
      .single()
    if (error) {
      // Unique index violation = active timer elsewhere
      setGlobalActiveWarning('Ya tienes un timer activo en otro lugar. Detenlo primero.')
      setSaving(false)
      return
    }
    if (inserted) {
      setGlobalActiveWarning(null)
      const timer: ActiveTimer = {
        entryId: inserted.id,
        startedAt: new Date(startedAt).getTime(),
        title: newTitle.trim(),
        phase: newPhase,
      }
      localStorage.setItem(TIMER_KEY(requirementId, currentUserId), JSON.stringify(timer))
      setActiveTimer(timer)
      setElapsed(0)
      setNewTitle('')
    }
    setSaving(false)
  }

  async function stopTimer() {
    if (!activeTimer) return
    setSaving(true)
    const endedAt = new Date()
    const durationSeconds = Math.floor((endedAt.getTime() - activeTimer.startedAt) / 1000)
    const supabase = createClient()
    await supabase
      .from('time_entries')
      .update({ ended_at: endedAt.toISOString(), duration_seconds: durationSeconds })
      .eq('id', activeTimer.entryId)
    localStorage.removeItem(TIMER_KEY(requirementId, currentUserId))
    setActiveTimer(null)
    setElapsed(0)
    if (intervalRef.current) clearInterval(intervalRef.current)
    await loadEntries()
    setSaving(false)
  }

  async function addManualEntry() {
    if (!newTitle.trim()) { setTitleError(true); return }
    setTitleError(false)
    setManualError(null)

    if (!manualStartedAt || !manualEndedAt) {
      setManualError('Completa la fecha/hora de inicio y fin.')
      return
    }

    // Convertir valores de datetime-local (hora local sin TZ) a UTC ISO en el browser
    const startUtc = localInputToUtc(manualStartedAt)
    const endUtc   = localInputToUtc(manualEndedAt)
    const secs = Math.round((new Date(endUtc).getTime() - new Date(startUtc).getTime()) / 1000)

    if (secs <= 0) {
      setManualError('La hora de fin debe ser posterior a la de inicio.')
      return
    }

    setSaving(true)
    const targetIsSelf = !canAssignToOthers || manualTargetUserId === currentUserId

    if (targetIsSelf) {
      const supabase = createClient()
      await supabase
        .from('time_entries')
        .insert({
          requirement_id: requirementId,
          user_id: currentUserId,
          entry_type: 'requirement',
          phase: newPhase,
          title: newTitle.trim(),
          started_at: startUtc,
          ended_at: endUtc,
          duration_seconds: secs,
        })
    } else {
      // Admin/supervisor carga tiempo a otro usuario — usa Server Action con validación de rol
      const result = await adminAddEntry({
        targetUserId: manualTargetUserId,
        entryType: 'requirement',
        requirementId,
        phase: newPhase,
        title: newTitle.trim(),
        startedAt: startUtc,
        endedAt: endUtc,
      })
      if (result.error) {
        setManualError(result.error)
        setSaving(false)
        return
      }
    }
    setNewTitle('')
    setManualStartedAt('')
    setManualEndedAt('')
    setShowManual(false)
    setManualTargetUserId(currentUserId)
    await loadEntries()
    setSaving(false)
  }

  // KPIs
  const totalSecs = entries.reduce((sum, e) => sum + (e.duration_seconds ?? 0), 0)
  const mySecs = entries
    .filter((e) => e.user_id === currentUserId)
    .reduce((sum, e) => sum + (e.duration_seconds ?? 0), 0)

  const phaseColor: Record<string, string> = {
    pendiente:           '#abadaf',
    proceso_edicion:     '#00675c',
    proceso_diseno:      '#0891b2',
    proceso_animacion:   '#7c3aed',
    cambios:             '#ea580c',
    pausa:               '#f59e0b',
    revision_interna:    '#6366f1',
    revision_diseno:     '#a855f7',
    revision_cliente:    '#f59e0b',
    aprobado:            '#22c55e',
    pendiente_publicar:  '#84cc16',
    publicado_entregado: '#2c2f31',
  }

  return (
    <div className="flex flex-col gap-4 px-5 py-4 overflow-y-auto h-full">

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2 flex-shrink-0">
        {[
          { label: 'Total req.', val: loading ? '…' : formatDuration(totalSecs) },
          { label: 'Mi tiempo', val: loading ? '…' : formatDuration(mySecs) },
          { label: 'Equipo', val: loading ? '…' : formatDuration(totalSecs - mySecs) },
        ].map(({ label, val }) => (
          <div key={label} className="bg-[#f5f7f9] rounded-2xl p-3 text-center">
            <div className="text-base font-black text-[#2c2f31]">{val}</div>
            <div className="text-[10px] font-bold text-[#747779] uppercase tracking-wider mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Non-trackable phase — info block */}
      {!canTrackTime && (
        <div className="flex gap-3 items-start bg-[#f5f7f9] border border-[#dfe3e6] rounded-2xl p-4 flex-shrink-0">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#abadaf] flex-shrink-0 mt-0.5">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          <div>
            <p className="text-sm font-semibold text-[#595c5e]">
              {isPassiveTimer ? 'Cronómetro automático' : 'Sin seguimiento de tiempo'}
            </p>
            <p className="text-xs text-[#747779] mt-1 leading-relaxed">
              {isPassiveTimer
                ? 'Esta fase tiene cronómetro automático; el tiempo transcurrido se registra desde la entrada a la fase. No requiere marcación manual.'
                : 'Esta fase no acumula tiempo de trabajo activo.'}
            </p>
          </div>
        </div>
      )}

      {/* Active timer */}
      {canTrackTime && activeTimer && (
        <div className="rounded-2xl p-4 border border-[#00675c]/30 flex-shrink-0"
          style={{ background: 'linear-gradient(135deg,#00675c08,#5bf4de10)' }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold text-[#595c5e] uppercase tracking-wider mb-1">Timer activo</p>
              <p className="text-sm font-bold text-[#2c2f31]">{activeTimer.title}</p>
              <p className="text-xs text-[#00675c] font-semibold mt-0.5">
                {PHASE_LABELS[activeTimer.phase as Phase] ?? activeTimer.phase}
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-2xl font-black text-[#00675c] tabular-nums tracking-tight">
                {formatClock(elapsed)}
              </div>
            </div>
          </div>
          <button
            onClick={stopTimer}
            disabled={saving}
            className="mt-3 flex items-center gap-1.5 bg-[#b31b25] text-white rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white"><path d="M6 6h12v12H6z"/></svg>
            {saving ? 'Guardando…' : 'Detener y guardar'}
          </button>
        </div>
      )}

      {/* Global active timer warning */}
      {globalActiveWarning && (
        <div className="flex gap-2 items-start bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-800 font-medium flex-shrink-0">
          <span className="material-symbols-outlined text-base text-amber-500 flex-shrink-0">warning</span>
          {globalActiveWarning}
        </div>
      )}

      {/* New entry form (hidden for non-trackable phases or while timer runs) */}
      {canTrackTime && !activeTimer && !globalActiveWarning && (
        <div className="border border-dashed border-[#dfe3e6] rounded-2xl p-4 space-y-3 flex-shrink-0">
          <p className="text-[10px] font-bold text-[#abadaf] uppercase tracking-wider">
            Nueva entrada de tiempo
          </p>

          <div className="space-y-1.5">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => { setNewTitle(e.target.value); setTitleError(false) }}
              placeholder="Título de la tarea (ej. Edición final)"
              className={`w-full px-3 py-2 text-sm bg-[#f5f7f9] border rounded-xl outline-none focus:border-[#00675c] text-[#2c2f31] ${
                titleError ? 'border-[#b31b25]' : 'border-[#dfe3e6]'
              }`}
            />
            {titleError && (
              <p className="text-xs text-[#b31b25]">El título es requerido.</p>
            )}
          </div>

          <select
            value={newPhase}
            onChange={(e) => setNewPhase(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl outline-none text-[#2c2f31]"
          >
            {USER_TRACKED_PHASES.map((p) => (
              <option key={p} value={p}>{PHASE_LABELS[p]}</option>
            ))}
          </select>

          <div className="flex gap-2">
            <button
              onClick={startTimer}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-bold text-white rounded-xl disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#00675c,#5bf4de)' }}
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-white"><path d="M8 5v14l11-7z"/></svg>
              Iniciar timer
            </button>
            <button
              onClick={() => setShowManual((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-bold text-[#595c5e] bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-[#595c5e]">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
              </svg>
              Manual
            </button>
          </div>

          {showManual && (
            <div className="space-y-2 pt-1">
              {canAssignToOthers && assignableUsers.length > 0 && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#abadaf] uppercase tracking-wider">
                    Registrar tiempo a
                  </label>
                  <select
                    value={manualTargetUserId}
                    onChange={(e) => setManualTargetUserId(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl outline-none text-[#2c2f31]"
                  >
                    <option value={currentUserId}>Yo mismo</option>
                    {assignableUsers
                      .filter((u) => u.id !== currentUserId)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name}
                        </option>
                      ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#abadaf] uppercase tracking-wider">
                    Inicio
                  </label>
                  <input
                    type="datetime-local"
                    value={manualStartedAt}
                    onChange={(e) => setManualStartedAt(e.target.value)}
                    className="w-full px-2 py-2 text-xs bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl outline-none focus:border-[#00675c] text-[#2c2f31]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-[#abadaf] uppercase tracking-wider">
                    Fin
                  </label>
                  <input
                    type="datetime-local"
                    value={manualEndedAt}
                    onChange={(e) => setManualEndedAt(e.target.value)}
                    className="w-full px-2 py-2 text-xs bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl outline-none focus:border-[#00675c] text-[#2c2f31]"
                  />
                </div>
              </div>
              {manualError && (
                <p className="text-xs text-[#b31b25]">{manualError}</p>
              )}
              <div className="flex justify-end">
                <button
                  onClick={addManualEntry}
                  disabled={saving || !manualStartedAt || !manualEndedAt}
                  className="px-4 py-2 text-sm font-bold text-white rounded-xl bg-[#00675c] disabled:opacity-50"
                >
                  {saving ? '…' : 'Agregar'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Entries list */}
      <div className="space-y-2 flex-shrink-0">
        {entries.length > 0 && (
          <p className="text-[10px] font-bold text-[#abadaf] uppercase tracking-wider">
            Entradas registradas
          </p>
        )}
        {loading ? (
          <p className="text-sm text-[#abadaf] text-center py-4">Cargando…</p>
        ) : entries.length === 0 && !loading ? (
          <p className="text-sm text-[#abadaf] text-center py-4">Sin entradas aún.</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 bg-white border border-[#eef1f3] rounded-xl p-3">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: phaseColor[entry.phase] ?? '#abadaf' }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#2c2f31] truncate">{entry.title}</p>
                <p className="text-xs text-[#747779]">
                  {PHASE_LABELS[entry.phase as Phase] ?? entry.phase} ·{' '}
                  {new Date(entry.started_at).toLocaleDateString('es', { day: 'numeric', month: 'short' })} ·{' '}
                  {entry.user?.full_name ?? 'Tú'}
                </p>
              </div>
              <UserAvatar
                name={entry.user?.full_name ?? 'Yo'}
                avatarUrl={entry.user?.avatar_url ?? null}
                size="xs"
              />
              <span className="text-sm font-black text-[#2c2f31] tabular-nums flex-shrink-0">
                {formatDuration(entry.duration_seconds ?? 0)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
