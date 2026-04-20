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
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import type { ClientWithPlan, BillingCycle, ContentType, Priority } from '@/types/db'
import { PRIORITY_LABELS, PRIORITY_COLORS } from '@/types/db'
import { CONTENT_TYPES, CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import { canRegister } from '@/lib/domain/requirement'
import { insertInitialPhaseLog } from '@/lib/domain/pipeline'

const CONTENT_ICONS: Record<ContentType, React.ReactNode> = {
  historia: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
    </svg>
  ),
  estatico: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
    </svg>
  ),
  video_corto: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
    </svg>
  ),
  reel: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/>
    </svg>
  ),
  short: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
    </svg>
  ),
  produccion: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/>
    </svg>
  ),
  reunion: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
    </svg>
  ),
}

interface RequirementModalProps {
  open: boolean
  onClose: () => void
  client: ClientWithPlan
  cycle: BillingCycle
  totals: Record<ContentType, number>
  limits: Record<ContentType, number>
  isAdmin: boolean
  canAssign?: boolean
  assignableUsers?: { id: string; full_name: string }[]
}

export function RequirementModal({
  open,
  onClose,
  client,
  cycle,
  totals,
  limits,
  isAdmin,
  canAssign = false,
  assignableUsers = [],
}: RequirementModalProps) {
  const router = useRouter()
  const [selectedType, setSelectedType] = useState<ContentType | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [priority, setPriority] = useState<Priority>('media')
  const [estimatedTime, setEstimatedTime] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [forceOverLimit, setForceOverLimit] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeTypes = CONTENT_TYPES.filter((t) => limits[t] > 0)
  const isSimpleType = selectedType === 'produccion' || selectedType === 'reunion'

  async function handleSubmit() {
    if (!selectedType) return
    setError(null)
    setLoading(true)

    const allowed = canRegister(selectedType, totals, limits)

    if (!allowed && !forceOverLimit) {
      setError('Límite alcanzado. Solo un admin puede forzar un requerimiento extra.')
      setLoading(false)
      return
    }

    if (!allowed && !isAdmin) {
      setError('No tienes permisos para registrar requerimientos por encima del límite.')
      setLoading(false)
      return
    }

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setError('Sesión expirada. Por favor recarga la página.')
      setLoading(false)
      return
    }

    const estMins = estimatedTime.trim() ? parseInt(estimatedTime.trim(), 10) : null
    const { data: newRequirement, error: insertError } = await supabase
      .from('requirements')
      .insert({
        billing_cycle_id: cycle.id,
        content_type: selectedType,
        title: title.trim(),
        registered_by_user_id: user.id,
        notes: notes.trim() || null,
        voided: false,
        over_limit: !allowed,
        priority,
        estimated_time_minutes: estMins && !isNaN(estMins) ? estMins : null,
        assigned_to: assignedTo || null,
      })
      .select('id')
      .single()

    if (insertError) {
      setError('Error al registrar el requerimiento. Intenta de nuevo.')
      setLoading(false)
      return
    }

    // Crear log inicial del pipeline (solo tipos que tienen fases; excluye produccion y reunion)
    if (selectedType !== 'produccion' && selectedType !== 'reunion' && newRequirement?.id) {
      await insertInitialPhaseLog(supabase, {
        requirementId: newRequirement.id,
        movedBy: user.id,
      })
    }

    setLoading(false)
    setSelectedType(null)
    setTitle('')
    setNotes('')
    setPriority('media')
    setEstimatedTime('')
    setAssignedTo('')
    setForceOverLimit(false)
    onClose()
    router.refresh()
  }

  const selectedAtLimit =
    selectedType !== null && !canRegister(selectedType, totals, limits)

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg rounded-2xl border border-[#abadaf]/20 shadow-xl p-0 overflow-hidden flex flex-col max-h-[90vh]">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-[#f0f3f5] flex-shrink-0">
          <DialogTitle className="text-lg font-semibold text-[#2c2f31]">
            Registrar requerimiento
          </DialogTitle>
          <p className="text-sm text-[#595c5e] mt-0.5">{client.name}</p>
        </DialogHeader>

        <div className="px-6 pt-4 pb-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Type selector */}
          <div>
            <Label className="text-sm font-medium text-[#2c2f31] mb-2 block">
              Tipo de contenido
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {activeTypes.map((type) => {
                const consumed = totals[type]
                const limit = limits[type]
                const atLimit = consumed >= limit
                const isSelected = selectedType === type

                return (
                  <button
                    key={type}
                    onClick={() => setSelectedType(type)}
                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all text-center ${
                      isSelected
                        ? 'border-[#00675c] bg-[#00675c]/5 text-[#00675c]'
                        : atLimit
                        ? 'border-[#b31b25]/30 bg-[#b31b25]/5 text-[#b31b25]/70'
                        : 'border-[#dfe3e6] bg-white text-[#595c5e] hover:border-[#00675c]/40'
                    }`}
                  >
                    <span>{CONTENT_ICONS[type]}</span>
                    <span className="text-xs font-medium leading-tight">
                      {CONTENT_TYPE_LABELS[type]}
                    </span>
                    <span className={`text-xs font-semibold ${atLimit ? 'text-[#b31b25]' : ''}`}>
                      {consumed}/{limit}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* At-limit warning */}
          {selectedAtLimit && (
            <div className="bg-[#b31b25]/5 border border-[#b31b25]/20 rounded-xl p-3">
              <p className="text-sm text-[#b31b25] font-medium mb-1">Límite alcanzado</p>
              <p className="text-xs text-[#b31b25]/80 mb-2">
                Este tipo de contenido ha alcanzado su límite mensual.
                {isAdmin && ' Como admin, puedes forzar el registro (quedará marcado como excedente).'}
              </p>
              {isAdmin && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={forceOverLimit}
                    onChange={(e) => setForceOverLimit(e.target.checked)}
                    className="rounded border-[#b31b25]/30 accent-[#b31b25]"
                  />
                  <span className="text-xs font-medium text-[#b31b25]">
                    Forzar requerimiento (marcar como excedente)
                  </span>
                </label>
              )}
            </div>
          )}

          {/* Title + Notes */}
          {selectedType && (
            <>
              <div>
                <Label htmlFor="title" className="text-sm font-medium text-[#2c2f31] mb-1.5 block">
                  Título{!isSimpleType && <span className="text-[#b31b25]"> *</span>}
                </Label>
                <input
                  id="title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={isSimpleType ? 'Título (opcional)' : 'Ej. Reel de lanzamiento mayo'}
                  className="w-full px-3 py-2 text-sm bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl focus:outline-none focus:border-[#00675c] text-[#2c2f31]"
                />
              </div>
              <div>
                <Label htmlFor="notes" className="text-sm font-medium text-[#2c2f31] mb-1.5 block">
                  Notas <span className="text-[#747779] font-normal">(opcional)</span>
                </Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Descripción del contenido, cliente, etc."
                  className="resize-none bg-[#f5f7f9] border-[#dfe3e6] focus:border-[#00675c] focus:ring-[#00675c]/20 rounded-xl"
                  rows={3}
                />
              </div>

              {/* Priority */}
              <div>
                <Label className="text-sm font-medium text-[#2c2f31] mb-1.5 block">Prioridad</Label>
                <div className="flex gap-2">
                  {(['baja', 'media', 'alta'] as Priority[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      className={`flex-1 py-2 rounded-xl text-sm font-bold border-2 transition-all flex items-center justify-center gap-1.5 ${
                        priority === p ? 'border-current' : 'border-[#dfe3e6] text-[#595c5e]'
                      }`}
                      style={priority === p ? { color: PRIORITY_COLORS[p], background: PRIORITY_COLORS[p] + '15' } : {}}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: PRIORITY_COLORS[p] }}
                      />
                      {PRIORITY_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Estimated time */}
              <div>
                <Label htmlFor="est-time" className="text-sm font-medium text-[#2c2f31] mb-1.5 block">
                  Tiempo estimado <span className="text-[#747779] font-normal">(min, opcional)</span>
                </Label>
                <input
                  id="est-time"
                  type="number"
                  min="1"
                  value={estimatedTime}
                  onChange={(e) => setEstimatedTime(e.target.value)}
                  placeholder="ej. 90"
                  className="w-full px-3 py-2 text-sm bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl focus:outline-none focus:border-[#00675c] text-[#2c2f31]"
                />
              </div>

              {/* Assign to — only for admin/supervisor */}
              {canAssign && assignableUsers.length > 0 && (
                <div>
                  <Label htmlFor="assigned-to" className="text-sm font-medium text-[#2c2f31] mb-1.5 block">
                    Asignar a <span className="text-[#747779] font-normal">(opcional)</span>
                  </Label>
                  <select
                    id="assigned-to"
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl outline-none focus:border-[#00675c] text-[#2c2f31]"
                  >
                    <option value="">Sin asignar</option>
                    {assignableUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.full_name}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          {/* Impact preview */}
          {selectedType && (
            <div className="bg-[#f5f7f9] rounded-xl p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#595c5e]">
                  {CONTENT_TYPE_LABELS[selectedType]}
                </span>
                <span className="text-sm font-semibold text-[#2c2f31]">
                  {totals[selectedType]} → <span className="text-[#00675c]">{totals[selectedType] + 1}</span>
                  <span className="text-[#595c5e] font-normal"> /{limits[selectedType]}</span>
                </span>
              </div>
              {selectedType === 'reunion' && cycle.limits_snapshot_json.reunion_duracion_horas && (
                <p className="text-xs text-[#747779]">
                  Duración por reunión: <span className="font-semibold">{cycle.limits_snapshot_json.reunion_duracion_horas}h</span>
                </p>
              )}
            </div>
          )}

        </div>

        {/* Footer fijo */}
        <div className="px-6 py-4 border-t border-[#f0f3f5] flex-shrink-0 space-y-3">
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
              onClick={handleSubmit}
              disabled={
                !selectedType ||
                loading ||
                (!title.trim() && !isSimpleType) ||
                (selectedAtLimit && !forceOverLimit)
              }
              className="flex-1 rounded-xl text-white font-semibold"
              style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
            >
              {loading ? 'Registrando...' : 'Confirmar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
