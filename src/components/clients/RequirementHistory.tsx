'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Requirement, RequirementCambioLog, ContentType } from '@/types/db'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import { CONTENT_ICONS } from '@/lib/domain/content-icons'

const AMBER_TYPES = new Set<ContentType>(['estatico', 'video_corto'])

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
  cycleId: string
  userMap: Record<string, string>
  cambioLogsMap: Record<string, RequirementCambioLog[]>
}

export function RequirementHistory({
  requirements,
  isAdmin,
  userMap,
  cambioLogsMap: initialCambioLogsMap,
}: RequirementHistoryProps) {
  const router = useRouter()
  const [voidingId, setVoidingId] = useState<string | null>(null)
  const [incrementingId, setIncrementingId] = useState<string | null>(null)
  // Which requirement's cambio form is open
  const [cambioFormId, setCambioFormId] = useState<string | null>(null)
  const [cambioNote, setCambioNote] = useState('')
  // Local cambio logs (optimistic update)
  const [cambioLogsMap, setCambioLogsMap] = useState(initialCambioLogsMap)
  // Which requirement's log list is expanded
  const [expandedId, setExpandedId] = useState<string | null>(null)

  async function handleVoid(requirementId: string) {
    setVoidingId(requirementId)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('requirements').update({
      voided: true,
      voided_by_user_id: user?.id,
      voided_at: new Date().toISOString(),
    }).eq('id', requirementId)

    // Cleanup de adjuntos del chat — presupuesto 50MB total en Supabase Free.
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

  async function handleAddCambio(requirementId: string) {
    setIncrementingId(requirementId)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const note = cambioNote.trim() || null
    const currentCount = requirements.find(r => r.id === requirementId)?.cambios_count ?? 0

    await Promise.all([
      supabase.from('requirements').update({ cambios_count: currentCount + 1 }).eq('id', requirementId),
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
    setCambioLogsMap(prev => ({
      ...prev,
      [requirementId]: [newLog, ...(prev[requirementId] ?? [])],
    }))
    setCambioFormId(null)
    setCambioNote('')
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
          const isAmber = AMBER_TYPES.has(type)
          const iconBg = isAmber ? 'bg-amber-100/60' : 'bg-fm-primary-container/30'
          const iconColor = isAmber ? 'text-amber-600' : 'text-fm-primary'
          const userName = userMap[r.registered_by_user_id] ?? 'Operador'
          const logs = cambioLogsMap[r.id] ?? []
          const isExpanded = expandedId === r.id
          const isCambioOpen = cambioFormId === r.id

          return (
            <div
              key={r.id}
              className={`px-6 py-4 ${r.voided ? 'opacity-40' : ''}`}
            >
              <div className="flex items-center justify-between hover:bg-transparent transition-colors">
                <div className="flex items-center gap-4">
                  {/* Icon box */}
                  <div className={`p-2 ${iconBg} rounded-xl flex-shrink-0`}>
                    <span className={`material-symbols-outlined ${iconColor} text-base`}>
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
                      {/* Cambios badge — clickable to expand logs */}
                      {!r.voided && type !== 'produccion' && type !== 'reunion' && logs.length > 0 && (
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : r.id)}
                          className="ml-2 text-xs font-medium px-1.5 py-0.5 rounded text-fm-on-surface-variant bg-fm-outline-variant/20 hover:bg-fm-outline-variant/40 transition-colors"
                        >
                          {logs.length} {logs.length === 1 ? 'cambio' : 'cambios'} {isExpanded ? '▲' : '▼'}
                        </button>
                      )}
                      {!r.voided && type !== 'produccion' && type !== 'reunion' && logs.length === 0 && r.cambios_count > 0 && (
                        <span className="ml-2 text-xs font-medium px-1.5 py-0.5 rounded text-fm-on-surface-variant bg-fm-outline-variant/20">
                          {r.cambios_count} {r.cambios_count === 1 ? 'cambio' : 'cambios'}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-fm-on-surface-variant mt-0.5">
                      <span className="text-fm-outline-variant">{CONTENT_TYPE_LABELS[type]}</span>
                      {r.notes && <span> — {r.notes}</span>}
                    </p>
                    <p className="text-xs text-fm-on-surface-variant mt-0.5">
                      {daysAgo(r.registered_at)}&nbsp;·&nbsp;por{' '}
                      <span className="font-semibold text-fm-on-surface">{userName}</span>
                    </p>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                  {/* +1 cambio */}
                  {!r.voided && type !== 'produccion' && type !== 'reunion' && (
                    <button
                      onClick={() => {
                        setCambioFormId(isCambioOpen ? null : r.id)
                        setCambioNote('')
                      }}
                      disabled={incrementingId === r.id}
                      className="text-xs font-bold transition-colors disabled:opacity-30 text-fm-primary hover:underline"
                    >
                      {incrementingId === r.id ? '...' : '+1 cambio'}
                    </button>
                  )}
                  {/* Void button */}
                  {!r.voided && (
                    <button
                      onClick={() => handleVoid(r.id)}
                      disabled={voidingId === r.id || !isAdmin}
                      className="text-fm-error text-xs font-bold hover:underline transition-colors disabled:opacity-30"
                    >
                      {voidingId === r.id ? '...' : 'Anular'}
                    </button>
                  )}
                </div>
              </div>

              {/* Inline cambio form */}
              {isCambioOpen && (
                <div className="mt-3 ml-14 space-y-2 p-3 bg-fm-background rounded-xl border border-fm-surface-container-high">
                  <p className="text-xs font-semibold text-fm-on-surface-variant">Descripción del cambio</p>
                  <textarea
                    value={cambioNote}
                    onChange={e => setCambioNote(e.target.value)}
                    placeholder="¿Qué cambió? (opcional)"
                    rows={2}
                    className="w-full text-xs bg-fm-surface-container-lowest border border-fm-surface-container-high rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-fm-primary text-fm-on-surface"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setCambioFormId(null); setCambioNote('') }}
                      className="flex-1 py-1.5 text-xs font-semibold border border-fm-surface-container-high rounded-lg text-fm-on-surface-variant hover:bg-fm-surface-container-lowest bg-transparent"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => handleAddCambio(r.id)}
                      disabled={incrementingId === r.id}
                      className="flex-1 py-1.5 text-xs font-semibold rounded-lg text-white bg-fm-primary hover:bg-fm-primary-dim disabled:opacity-50"
                    >
                      {incrementingId === r.id ? 'Registrando…' : 'Registrar'}
                    </button>
                  </div>
                </div>
              )}

              {/* Cambio logs list */}
              {isExpanded && logs.length > 0 && (
                <div className="mt-3 ml-14 space-y-2">
                  {logs.map((log, i) => (
                    <div key={log.id} className="flex gap-2 items-start">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-fm-outline-variant flex-shrink-0" />
                      <div>
                        <p className="text-[10px] text-fm-outline-variant">
                          Cambio {logs.length - i} ·{' '}
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
          )
        })}
      </div>
    </div>
  )
}
