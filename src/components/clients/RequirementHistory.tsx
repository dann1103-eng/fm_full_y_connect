'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Requirement, RequirementCambioLog, ContentType } from '@/types/db'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import { CONTENT_ICONS } from '@/lib/domain/content-icons'
import { voidCambioLog, approveCambioLog, rejectCambioLog, addCambioLog } from '@/app/actions/cambioLogs'

const TYPE_ACTION: Record<ContentType, string> = {
  historia: 'Historia registrada',
  estatico: 'Estático registrado',
  video_corto: 'Video corto registrado',
  reel: 'Reel registrado',
  short: 'Short registrado',
  produccion: 'Producción registrada',
  reunion: 'Reunión registrada',
  matriz_contenido: 'Matriz de contenido registrada',
}

function daysAgo(dateStr: string): string {
  const date = new Date(dateStr)
  const diffMs = Date.now() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'hoy'
  if (diffDays === 1) return 'hace 1 día'
  if (diffDays < 7) return `hace ${diffDays} días`
  if (diffDays < 14) return 'hace 1 semana'
  if (diffDays < 21) return 'hace 2 semanas'
  return `hace ${Math.floor(diffDays / 7)} semanas`
}

interface RequirementHistoryProps {
  requirements: Requirement[]
  isAdmin: boolean
  /** true si el usuario es admin o supervisor (puede aprobar/rechazar cambios) */
  isApprover?: boolean
  cycleId: string
  userMap: Record<string, string>
  cambioLogsMap: Record<string, RequirementCambioLog[]>
}

export function RequirementHistory({
  requirements,
  isAdmin,
  isApprover = false,
  userMap,
  cambioLogsMap: initialCambioLogsMap,
}: RequirementHistoryProps) {
  const router = useRouter()
  const [voidingId, setVoidingId] = useState<string | null>(null)
  const [incrementingId, setIncrementingId] = useState<string | null>(null)
  const [voidingLogId, setVoidingLogId] = useState<string | null>(null)
  const [approvingLogId, setApprovingLogId] = useState<string | null>(null)
  const [rejectingLogId, setRejectingLogId] = useState<string | null>(null)
  // Formulario de nuevo cambio abierto
  const [cambioFormId, setCambioFormId] = useState<string | null>(null)
  const [cambioNote, setCambioNote] = useState('')
  const [cambioError, setCambioError] = useState<string | null>(null)
  // Logs locales (actualización optimista)
  const [cambioLogsMap, setCambioLogsMap] = useState(initialCambioLogsMap)
  // Override del contador para decrementos optimistas (anular)
  const [cambiosCountOverride, setCambiosCountOverride] = useState<Record<string, number>>({})
  // Historial expandido
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ─────────────────────── Anular log aprobado (solo admin) ───────────────────────
  async function handleVoidLog(logId: string, requirementId: string) {
    setVoidingLogId(logId)
    const result = await voidCambioLog(logId)
    if ('error' in result) {
      alert(result.error)
      setVoidingLogId(null)
      return
    }
    setCambioLogsMap((prev) => ({
      ...prev,
      [requirementId]: (prev[requirementId] ?? []).map((l) =>
        l.id === logId ? { ...l, voided: true, voided_at: new Date().toISOString() } : l,
      ),
    }))
    setCambiosCountOverride((prev) => {
      const current = prev[requirementId] ?? requirements.find((r) => r.id === requirementId)?.cambios_count ?? 0
      return { ...prev, [requirementId]: Math.max(0, current - 1) }
    })
    setVoidingLogId(null)
    router.refresh()
  }

  // ─────────────────────── Aprobar cambio pendiente ───────────────────────
  async function handleApproveLog(logId: string, requirementId: string) {
    setApprovingLogId(logId)
    const result = await approveCambioLog(logId)
    if ('error' in result) {
      alert(result.error)
      setApprovingLogId(null)
      return
    }
    setCambioLogsMap((prev) => ({
      ...prev,
      [requirementId]: (prev[requirementId] ?? []).map((l) =>
        l.id === logId ? { ...l, status: 'approved' } : l,
      ),
    }))
    // El contador sube en 1 (el servidor lo hizo; actualizamos local)
    setCambiosCountOverride((prev) => {
      const current = prev[requirementId] ?? requirements.find((r) => r.id === requirementId)?.cambios_count ?? 0
      return { ...prev, [requirementId]: current + 1 }
    })
    setApprovingLogId(null)
    router.refresh()
  }

  // ─────────────────────── Rechazar cambio pendiente ───────────────────────
  async function handleRejectLog(logId: string, requirementId: string) {
    setRejectingLogId(logId)
    const result = await rejectCambioLog(logId)
    if ('error' in result) {
      alert(result.error)
      setRejectingLogId(null)
      return
    }
    setCambioLogsMap((prev) => ({
      ...prev,
      [requirementId]: (prev[requirementId] ?? []).map((l) =>
        l.id === logId ? { ...l, status: 'rejected' } : l,
      ),
    }))
    setRejectingLogId(null)
    router.refresh()
  }

  // ─────────────────────── Anular requerimiento completo ───────────────────────
  async function handleVoid(requirementId: string) {
    setVoidingId(requirementId)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('requirements').update({
      voided: true,
      voided_by_user_id: user?.id,
      voided_at: new Date().toISOString(),
    }).eq('id', requirementId)

    try {
      const { data: files } = await supabase.storage
        .from('requirement-attachments')
        .list(requirementId)
      if (files && files.length > 0) {
        const paths = files.map((f) => `${requirementId}/${f.name}`)
        await supabase.storage.from('requirement-attachments').remove(paths)
      }
    } catch (err) {
      console.error('Cleanup de adjuntos al anular req falló:', err)
    }

    setVoidingId(null)
    router.refresh()
  }

  // ─────────────────────── Registrar nuevo cambio ───────────────────────
  async function handleAddCambio(requirementId: string) {
    setCambioError(null)
    const note = cambioNote.trim()
    if (!note) {
      setCambioError('La descripción del cambio es obligatoria.')
      return
    }

    setIncrementingId(requirementId)
    // Usar server action para obtener ID real de BD y evitar problemas de RLS
    const result = await addCambioLog(requirementId, note)

    if ('error' in result) {
      setCambioError(result.error)
      setIncrementingId(null)
      return
    }

    const newLog: RequirementCambioLog = {
      id: result.log.id,
      requirement_id: requirementId,
      notes: note,
      created_by: null, // el server action conoce el usuario
      created_at: result.log.created_at,
      voided: false,
      voided_by_user_id: null,
      voided_at: null,
      status: result.log.status,
      paid_from_credit_id: null,
    }
    setCambioLogsMap(prev => ({
      ...prev,
      [requirementId]: [newLog, ...(prev[requirementId] ?? [])],
    }))
    if (result.log.status === 'approved') {
      setCambiosCountOverride(prev => {
        const current = prev[requirementId] ?? requirements.find(r => r.id === requirementId)?.cambios_count ?? 0
        return { ...prev, [requirementId]: current + 1 }
      })
    }
    setCambioFormId(null)
    setCambioNote('')
    setCambioError(null)
    setExpandedId(requirementId)
    setIncrementingId(null)
    router.refresh()
  }

  if (requirements.length === 0) {
    return (
      <div className="glass-panel rounded-[2rem] p-8 text-center">
        <p className="text-sm text-fm-on-surface-variant">Sin requerimientos registrados en este ciclo.</p>
      </div>
    )
  }

  return (
    <div className="glass-panel rounded-[2rem] overflow-hidden">
      <div className="divide-y divide-fm-surface-container-high/60">
        {requirements.map((r) => {
          const type = r.content_type as ContentType
          const userName = userMap[r.registered_by_user_id] ?? 'Operador'
          const logs = cambioLogsMap[r.id] ?? []
          // Logs visibles: no-voided y no-rejected (pending + approved)
          const visibleLogs = logs.filter((l) => !l.voided && l.status !== 'rejected')
          const approvedLogs = visibleLogs.filter((l) => l.status === 'approved')
          const pendingLogs = visibleLogs.filter((l) => l.status === 'pending')
          const effectiveCambiosCount = cambiosCountOverride[r.id] ?? r.cambios_count
          const isExpanded = expandedId === r.id
          const isCambioOpen = cambioFormId === r.id
          const overrides = r.consumption_overrides_json
          const overrideEntries = overrides
            ? (Object.entries(overrides) as [ContentType, number][]).filter(([, qty]) => (qty ?? 0) > 0)
            : []

          return (
            <div
              key={r.id}
              className={`px-6 py-4 ${r.voided ? 'opacity-40' : ''}`}
            >
              <div className="flex items-center justify-between hover:bg-transparent transition-colors">
                <div className="flex items-center gap-4">
                  {/* Icon box */}
                  <div className="content-chip p-2 rounded-xl flex-shrink-0">
                    <span className="content-icon material-symbols-outlined text-base">
                      {CONTENT_ICONS[type]}
                    </span>
                  </div>

                  {/* Text */}
                  <div>
                    <p className="text-sm font-bold text-fm-on-surface">
                      {r.title || TYPE_ACTION[type] || CONTENT_TYPE_LABELS[type]}
                      {r.voided && (
                        <span className="ml-2 text-xs font-medium text-fm-outline bg-fm-outline-variant/20 px-1.5 py-0.5 rounded">
                          Anulado
                        </span>
                      )}
                      {r.over_limit && !r.voided && (
                        <span className="ml-2 text-xs font-medium text-fm-error bg-fm-error/10 px-1.5 py-0.5 rounded">
                          Excedente
                        </span>
                      )}
                      {/* Badge de cambios aprobados (clickable) */}
                      {!r.voided && type !== 'produccion' && type !== 'reunion' && logs.length > 0 && approvedLogs.length > 0 && (
                        <button type="button"
                          onClick={() => setExpandedId(isExpanded ? null : r.id)}
                          className="ml-2 text-xs font-medium px-1.5 py-0.5 rounded text-fm-on-surface-variant bg-fm-outline-variant/20 hover:bg-fm-outline-variant/40 transition-colors"
                        >
                          {approvedLogs.length} {approvedLogs.length === 1 ? 'cambio' : 'cambios'} {isExpanded ? '▲' : '▼'}
                        </button>
                      )}
                      {/* Badge de cambios sin logs (legacy) */}
                      {!r.voided && type !== 'produccion' && type !== 'reunion' && logs.length === 0 && effectiveCambiosCount > 0 && (
                        <span className="ml-2 text-xs font-medium px-1.5 py-0.5 rounded text-fm-on-surface-variant bg-fm-outline-variant/20">
                          {effectiveCambiosCount} {effectiveCambiosCount === 1 ? 'cambio' : 'cambios'}
                        </span>
                      )}
                      {/* Badge de pendientes */}
                      {!r.voided && type !== 'produccion' && type !== 'reunion' && pendingLogs.length > 0 && (
                        <button type="button"
                          onClick={() => setExpandedId(isExpanded ? null : r.id)}
                          className="ml-1.5 text-xs font-medium px-1.5 py-0.5 rounded text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-400/15 hover:bg-amber-200 dark:hover:bg-amber-400/25 transition-colors"
                        >
                          ⏳ {pendingLogs.length} pendiente{pendingLogs.length > 1 ? 's' : ''}
                        </button>
                      )}
                    </p>
                    <p className="text-xs text-fm-on-surface-variant mt-0.5">
                      <span className="text-fm-outline-variant">{CONTENT_TYPE_LABELS[type]}</span>
                      {r.notes && <span> — {r.notes}</span>}
                    </p>
                    {/* Chip multi-consumo (admin) */}
                    {overrideEntries.length > 0 && !r.voided && (
                      <p className="text-xs mt-0.5 flex items-center gap-1 flex-wrap">
                        <span className="material-symbols-outlined text-fm-secondary text-[14px]">balance</span>
                        <span className="text-fm-secondary font-bold">Consume:</span>
                        {overrideEntries.map(([t, qty], idx) => (
                          <span key={t} className="text-fm-on-surface-variant">
                            {idx > 0 && <span className="text-fm-outline-variant">·</span>}{' '}
                            <span className="font-semibold text-fm-on-surface">{qty}</span> {CONTENT_TYPE_LABELS[t]}
                          </span>
                        ))}
                      </p>
                    )}
                    <p className="text-xs text-fm-on-surface-variant mt-0.5">
                      {daysAgo(r.registered_at)}&nbsp;·&nbsp;por{' '}
                      <span className="font-semibold text-fm-on-surface">{userName}</span>
                    </p>
                  </div>
                </div>

                {/* Botones de acción */}
                <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                  {!r.voided && type !== 'produccion' && type !== 'reunion' && (
                    <button type="button"
                      onClick={() => {
                        setCambioFormId(isCambioOpen ? null : r.id)
                        setCambioNote('')
                        setCambioError(null)
                      }}
                      disabled={incrementingId === r.id}
                      className="text-xs font-bold transition-colors disabled:opacity-30 text-fm-primary hover:underline"
                    >
                      {incrementingId === r.id ? '...' : '+1 cambio'}
                    </button>
                  )}
                  {!r.voided && (
                    <button type="button"
                      onClick={() => handleVoid(r.id)}
                      disabled={voidingId === r.id || !isAdmin}
                      className="text-fm-error text-xs font-bold hover:underline transition-colors disabled:opacity-30"
                    >
                      {voidingId === r.id ? '...' : 'Anular'}
                    </button>
                  )}
                </div>
              </div>

              {/* Formulario inline de nuevo cambio */}
              {isCambioOpen && (
                <div className="mt-3 ml-14 space-y-2 p-3 bg-fm-background rounded-xl border border-fm-surface-container-high">
                  <p className="text-xs font-semibold text-fm-on-surface-variant">
                    Descripción del cambio <span className="text-fm-error">*</span>
                  </p>
                  {!isApprover && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">info</span>
                      Quedará pendiente de aprobación por un supervisor o admin.
                    </p>
                  )}
                  <textarea aria-label="¿Qué cambió? (obligatorio)"
                    value={cambioNote}
                    onChange={e => { setCambioNote(e.target.value); setCambioError(null) }}
                    placeholder="¿Qué cambió? (obligatorio)"
                    rows={2}
                    className={`w-full text-xs bg-fm-surface-container-lowest border rounded-lg px-3 py-2 resize-none focus:outline-none text-fm-on-surface transition-colors ${
                      cambioError ? 'border-fm-error focus:border-fm-error' : 'border-fm-surface-container-high focus:border-fm-primary'
                    }`}
                  />
                  {cambioError && (
                    <p className="text-[10px] text-fm-error font-medium">{cambioError}</p>
                  )}
                  <div className="flex gap-2">
                    <button type="button"
                      onClick={() => { setCambioFormId(null); setCambioNote(''); setCambioError(null) }}
                      className="flex-1 py-1.5 text-xs font-semibold border border-fm-surface-container-high rounded-lg text-fm-on-surface-variant hover:bg-fm-surface-container-lowest bg-transparent"
                    >
                      Cancelar
                    </button>
                    <button type="button"
                      onClick={() => handleAddCambio(r.id)}
                      disabled={incrementingId === r.id}
                      className="flex-1 py-1.5 text-xs font-semibold rounded-lg text-white bg-fm-primary hover:bg-fm-primary-dim disabled:opacity-50"
                    >
                      {incrementingId === r.id ? 'Registrando…' : 'Registrar'}
                    </button>
                  </div>
                </div>
              )}

              {/* Lista de logs (expandible) */}
              {isExpanded && logs.length > 0 && (
                <div className="mt-3 ml-14 space-y-2">
                  {logs.map((log, i) => {
                    const voidedAuthor = log.voided_by_user_id ? userMap[log.voided_by_user_id] : null
                    const isPending = log.status === 'pending'
                    const isRejected = log.status === 'rejected'
                    const isApproved = log.status === 'approved'
                    const isDimmed = log.voided || isRejected

                    return (
                      <div key={log.id} className="flex gap-2 items-start">
                        <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          isDimmed
                            ? 'bg-fm-outline-variant/40'
                            : isPending
                              ? 'bg-amber-400'
                              : 'bg-fm-outline-variant'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <p className={`text-[10px] ${isDimmed ? 'text-fm-outline-variant/60' : 'text-fm-outline-variant'}`}>
                              Cambio {logs.length - i} ·{' '}
                              {new Date(log.created_at).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              {log.created_by && (
                                <>
                                  {' · '}
                                  <span className="font-semibold text-fm-on-surface-variant">
                                    {userMap[log.created_by] ?? 'Usuario'}
                                  </span>
                                </>
                              )}
                            </p>

                            {/* Badge de estado */}
                            {isPending && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-400/15 text-amber-700 dark:text-amber-400">
                                Pendiente
                              </span>
                            )}
                            {isRejected && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-fm-error/10 text-fm-error">
                                Rechazado
                              </span>
                            )}

                            {/* Botones de aprobación (solo si es aprobador y el log está pendiente) */}
                            {isPending && isApprover && (
                              <>
                                <button type="button"
                                  onClick={() => handleApproveLog(log.id, r.id)}
                                  disabled={approvingLogId === log.id || rejectingLogId === log.id}
                                  className="text-[10px] font-bold text-fm-primary hover:underline disabled:opacity-30"
                                >
                                  {approvingLogId === log.id ? '...' : 'Aprobar'}
                                </button>
                                <button type="button"
                                  onClick={() => handleRejectLog(log.id, r.id)}
                                  disabled={approvingLogId === log.id || rejectingLogId === log.id}
                                  className="text-[10px] font-bold text-fm-error hover:underline disabled:opacity-30"
                                >
                                  {rejectingLogId === log.id ? '...' : 'Rechazar'}
                                </button>
                              </>
                            )}

                            {/* Anular (solo admin, solo logs aprobados) */}
                            {isApproved && !log.voided && isAdmin && (
                              <button type="button"
                                onClick={() => handleVoidLog(log.id, r.id)}
                                disabled={voidingLogId === log.id}
                                className="text-[10px] font-bold text-fm-error hover:underline disabled:opacity-30"
                              >
                                {voidingLogId === log.id ? '...' : 'Anular'}
                              </button>
                            )}
                          </div>

                          {/* Descripción */}
                          {log.notes ? (
                            <p className={`text-xs mt-0.5 ${isDimmed ? 'text-fm-outline-variant line-through' : 'text-fm-on-surface'}`}>
                              {log.notes}
                            </p>
                          ) : (
                            <p className={`text-xs italic mt-0.5 ${isDimmed ? 'text-fm-outline-variant/60 line-through' : 'text-fm-outline-variant'}`}>
                              Sin descripción
                            </p>
                          )}

                          {/* Info de anulación */}
                          {log.voided && (
                            <p className="text-[10px] text-fm-outline-variant/70 mt-0.5">
                              Anulado{voidedAuthor ? ` por ${voidedAuthor}` : ''}
                              {log.voided_at && ` · ${new Date(log.voided_at).toLocaleDateString('es', { day: 'numeric', month: 'short' })}`}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
