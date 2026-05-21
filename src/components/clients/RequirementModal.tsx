'use client'

import { useState, useEffect } from 'react'
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
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, TIPPABLE_CONTENT_TYPES } from '@/lib/domain/plans'
import { canRegisterWithContext, canRegisterBreakdown, weekIndexInCycle, maxWeeksForPeriod } from '@/lib/domain/requirement'
import { insertInitialPhaseLog } from '@/lib/domain/pipeline'
import { consumeContentCreditForRequirement } from '@/app/actions/credits'

const CONTENT_ICONS: Record<ContentType, React.ReactNode> = {
  historia: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-2-1.99-1.99zM17 19H7V5h10v14z"/>
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
  matriz_contenido: (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 3h8v8H3zm0 10h8v8H3zm10-10h8v8h-8zm0 10h8v8h-8z"/>
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
  /** Créditos sin caducidad disponibles para el cliente, por content_type. Se suman al límite del ciclo al validar. */
  availableCredits?: Partial<Record<ContentType, number>>
  /** Cliente con plan "Licencia de Contenido Avanzada" — pool unificado entre tipos tippables.
   *  Cuando true, el modal valida contra el pool y oculta contadores individuales por tipo. */
  isUnifiedPool?: boolean
  /** Uso del pool unificado (used/limit). Solo aplica cuando isUnifiedPool=true. */
  poolUsage?: { used: number; limit: number } | null
  isAdmin: boolean
  /** Admin estricto (rol = 'admin') puede definir consumo personalizado multi-tipo. */
  isStrictAdmin?: boolean
  canAssign?: boolean
  assignableUsers?: { id: string; full_name: string; default_assignee?: boolean }[]
}

export function RequirementModal({
  open,
  onClose,
  client,
  cycle,
  totals,
  limits,
  availableCredits = {},
  isUnifiedPool = false,
  poolUsage = null,
  isAdmin,
  isStrictAdmin = false,
  canAssign = false,
  assignableUsers = [],
}: RequirementModalProps) {
  const router = useRouter()
  const [selectedType, setSelectedType] = useState<ContentType | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [priority, setPriority] = useState<Priority>('media')
  const [estHours, setEstHours] = useState<string>('')
  const [estMinsField, setEstMinsField] = useState<string>('')
  const [assignedTo, setAssignedTo] = useState<string[]>([])
  const [forceOverLimit, setForceOverLimit] = useState(false)
  const [deadline, setDeadline] = useState('')
  const [includesStory, setIncludesStory] = useState(true)

  // Multi-consumo (solo admin estricto). Map ContentType -> cantidad. Vacío = legacy.
  const [overridesOpen, setOverridesOpen] = useState(false)
  const [consumptionOverrides, setConsumptionOverrides] = useState<Partial<Record<ContentType, number>>>({})

  function setOverrideQty(type: ContentType, qty: number) {
    setConsumptionOverrides((prev) => {
      const next = { ...prev }
      if (qty <= 0 || !Number.isFinite(qty)) delete next[type]
      else next[type] = qty
      return next
    })
  }

  // Pre-seleccionar usuarios con `default_assignee=true` cada vez que se abre el modal,
  // solo si el usuario aún no ha tocado la selección (assignedTo vacío).
  useEffect(() => {
    if (!open) return
    if (assignedTo.length > 0) return
    const defaults = assignableUsers
      .filter((u) => u.default_assignee)
      .map((u) => u.id)
    if (defaults.length > 0) setAssignedTo(defaults)
  // Dependemos de `open` y `assignableUsers` — no incluir assignedTo para no sobrescribir cambios manuales
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assignableUsers])
  const [startsAt, setStartsAt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Límite efectivo = límite del plan + créditos sin caducidad disponibles para ese tipo.
  // Esto permite que clientes con paquetes (sin plan) o que ya consumieron su plan
  // puedan registrar requerimientos contra los créditos.
  const limitsWithCredits = CONTENT_TYPES.reduce((acc, t) => {
    acc[t] = (limits[t] ?? 0) + (availableCredits[t] ?? 0)
    return acc
  }, {} as Record<ContentType, number>)

  // Tipos visibles: los que tengan límite del plan O créditos disponibles.
  const activeTypes = CONTENT_TYPES.filter((t) => limitsWithCredits[t] > 0)
  const isSimpleType = selectedType === 'produccion' || selectedType === 'reunion'
  const isScheduledType = isSimpleType
  const STORY_APPLICABLE_TYPES: ContentType[] = ['estatico', 'video_corto', 'reel', 'short']
  const storyApplicable = selectedType !== null && STORY_APPLICABLE_TYPES.includes(selectedType)

  // Reset default del switch cada vez que cambia a un tipo aplicable.
  // Para tipos no aplicables, se oculta el control y se fuerza a false al insert.
  useEffect(() => {
    if (storyApplicable) setIncludesStory(true)
    else setIncludesStory(false)
  }, [storyApplicable])

  async function handleSubmit() {
    if (!selectedType) return
    setError(null)
    setLoading(true)

    // Payment gate — si la semana actual está bloqueada, detener (no bypasseable por admin).
    const currentWeek = weekIndexInCycle(new Date(), cycle.period_start, maxWeeksForPeriod(client.billing_period))
    const gate = canRegisterWithContext(selectedType, totals, limits, {
      week: currentWeek,
      cycle,
      client,
    })
    if (!gate.ok && gate.reason?.startsWith('Pago pendiente')) {
      setError(`${gate.reason}. Registra el pago antes de crear requerimientos en esta semana.`)
      setLoading(false)
      return
    }

    // Construye el breakdown efectivo: siempre parte de la base (1 del tipo + historia si aplica)
    // y fusiona los overrides encima (el admin modifica cantidades, no reemplaza todo el mapa).
    // Debe coincidir exactamente con lo que computará consumptionOf() al leer el registro.
    const hasOverrides = isStrictAdmin && Object.values(consumptionOverrides).some((v) => (v ?? 0) > 0)
    const effectiveBreakdown: Partial<Record<ContentType, number>> = (() => {
      const base: Partial<Record<ContentType, number>> = { [selectedType]: 1 }
      if (storyApplicable && includesStory && selectedType !== 'historia') base.historia = 1
      if (hasOverrides) {
        for (const [type, qty] of Object.entries(consumptionOverrides)) {
          const n = qty ?? 0
          if (n <= 0) delete base[type as ContentType]
          else base[type as ContentType] = n
        }
      }
      return base
    })()

    // Créditos sin caducidad amplían el límite efectivo: si tienes 3 shorts en créditos y el plan permite 5,
    // el "techo" para validar este insert es 8.
    const limitsWithCredits: Record<ContentType, number> = { ...limits }
    for (const [type, qty] of Object.entries(availableCredits)) {
      const t = type as ContentType
      limitsWithCredits[t] = (limits[t] ?? 0) + (qty ?? 0)
    }

    // En pool unificado el blocker es el pool, no los límites por tipo.
    let allowed: boolean
    let blockReason: string | null = null
    if (isUnifiedPool && poolUsage !== null) {
      const sum = TIPPABLE_CONTENT_TYPES.reduce((s, t) => s + (effectiveBreakdown[t] ?? 0), 0)
      const overflows = poolUsage.used + sum > poolUsage.limit
      allowed = !overflows
      if (!allowed) {
        blockReason = 'Paquete completo. Contrata otro paquete o anula un requerimiento existente.'
      }
    } else {
      const breakdownCheck = canRegisterBreakdown(effectiveBreakdown, totals, limitsWithCredits)
      allowed = breakdownCheck.ok
      if (!allowed) {
        const exceeded = breakdownCheck.exceeded
        const exceededLabel = exceeded ? CONTENT_TYPE_LABELS[exceeded] : 'el tipo seleccionado'
        blockReason = `Límite de ${exceededLabel} alcanzado. Solo un admin puede forzar un requerimiento extra.`
      }
    }

    if (!allowed && !forceOverLimit) {
      setError(blockReason ?? 'No se puede registrar este requerimiento.')
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

    const h = estHours.trim() ? parseInt(estHours.trim(), 10) : 0
    const m = estMinsField.trim() ? parseInt(estMinsField.trim(), 10) : 0
    const estMins = (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m) || null

    if (isScheduledType) {
      if (!startsAt) {
        setError('La fecha y hora son obligatorias para reuniones y producciones.')
        setLoading(false)
        return
      }
      if (!estMins || estMins < 1) {
        setError('La duración es obligatoria para reuniones y producciones.')
        setLoading(false)
        return
      }

      // Anti-choque: buscar solapamiento con mismos usuarios asignados
      if (assignedTo.length > 0) {
        const newStart = new Date(startsAt)
        const newEnd = new Date(newStart.getTime() + estMins * 60 * 1000)
        const { data: conflicts } = await supabase
          .from('requirements')
          .select('id, title, starts_at, estimated_time_minutes, assigned_to')
          .in('content_type', ['reunion', 'produccion'])
          .eq('voided', false)
          .not('starts_at', 'is', null)
          .overlaps('assigned_to', assignedTo)
        if (conflicts) {
          for (const c of conflicts) {
            const cStart = new Date(c.starts_at!)
            const cEnd = new Date(cStart.getTime() + (c.estimated_time_minutes ?? 60) * 60 * 1000)
            if (newStart < cEnd && newEnd > cStart) {
              const conflictingIds = (c.assigned_to ?? []).filter((id: string) => assignedTo.includes(id))
              const names = conflictingIds
                .map((id: string) => assignableUsers.find(u => u.id === id)?.full_name ?? id)
              setError(
                `${names.join(', ')} ya ${names.length === 1 ? 'está programado' : 'están programados'} para "${c.title || 'otra reunión/producción'}" a esa hora.`
              )
              setLoading(false)
              return
            }
          }
        }
      }
    } else {
      if (!deadline.trim()) {
        setError('La fecha de entrega es obligatoria.')
        setLoading(false)
        return
      }
      if (!estMins || estMins < 1) {
        setError('El tiempo estimado es obligatorio.')
        setLoading(false)
        return
      }
    }

    const startsAtISO = isScheduledType && startsAt ? new Date(startsAt).toISOString() : null

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
        priority: isScheduledType ? undefined : priority,
        estimated_time_minutes: estMins && !isNaN(estMins) ? estMins : null,
        assigned_to: assignedTo.length > 0 ? assignedTo : null,
        includes_story: storyApplicable ? includesStory : false,
        deadline: isScheduledType ? null : (deadline.trim() || null),
        starts_at: startsAtISO,
        consumption_overrides_json: hasOverrides ? effectiveBreakdown : null,
      })
      .select('id')
      .single()

    if (insertError) {
      // Mostrar el mensaje del trigger SQL (ej. "Cliente suspendido por falta de pago",
      // "No se puede registrar requerimientos en la semana X sin el pago correspondiente")
      // en lugar de un genérico que oculta la causa real.
      console.error('[RequirementModal] insertError:', insertError)
      setError(insertError.message || 'Error al registrar el requerimiento. Intenta de nuevo.')
      setLoading(false)
      return
    }

    // Si este requerimiento excede el cupo del ciclo pero hay créditos disponibles para su content_type,
    // consumir un crédito y limpiar el flag over_limit. Si falla, anular el requerimiento.
    if (newRequirement?.id) {
      const wouldOverflowCycle = (totals[selectedType] ?? 0) >= (limits[selectedType] ?? 0)
      const creditsForType = availableCredits[selectedType] ?? 0
      if (wouldOverflowCycle && creditsForType > 0) {
        const r = await consumeContentCreditForRequirement({
          requirementId: newRequirement.id,
          contentType: selectedType,
        })
        if (!r.ok) {
          await supabase.from('requirements').delete().eq('id', newRequirement.id)
          setError('No se pudo aplicar el crédito disponible. Intenta de nuevo.')
          setLoading(false)
          return
        }
      }
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
    setEstHours('')
    setEstMinsField('')
    setAssignedTo([])
    setForceOverLimit(false)
    setDeadline('')
    setStartsAt('')
    setIncludesStory(true)
    setConsumptionOverrides({})
    setOverridesOpen(false)
    onClose()
    router.refresh()
  }

  // Breakdown efectivo computado para validación + preview (mismo que handleSubmit).
  const hasActiveOverrides = isStrictAdmin && Object.values(consumptionOverrides).some((v) => (v ?? 0) > 0)
  const effectiveBreakdown: Partial<Record<ContentType, number>> = selectedType === null
    ? {}
    : hasActiveOverrides
      ? Object.fromEntries(
          Object.entries(consumptionOverrides).filter(([, v]) => (v ?? 0) > 0),
        ) as Partial<Record<ContentType, number>>
      : storyApplicable && includesStory && selectedType !== 'historia'
        ? { [selectedType]: 1, historia: 1 }
        : { [selectedType]: 1 }

  // En pool unificado: el blocker es el pool, no los límites individuales por tipo.
  const tippableSumInBreakdown = TIPPABLE_CONTENT_TYPES.reduce(
    (s, t) => s + (effectiveBreakdown[t] ?? 0),
    0,
  )
  const poolWouldOverflow =
    isUnifiedPool && poolUsage !== null && poolUsage.used + tippableSumInBreakdown > poolUsage.limit

  // Para el warning: en pool unificado dispara solo si el pool se llena.
  // En plan normal, dispara si ni el plan ni los créditos pueden cubrir.
  const selectedAtLimit =
    selectedType !== null &&
    (isUnifiedPool
      ? poolWouldOverflow
      : !canRegisterBreakdown(effectiveBreakdown, totals, limitsWithCredits).ok)

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg rounded-2xl border border-fm-outline-variant/20 shadow-xl p-0 overflow-hidden flex flex-col max-h-[90vh]">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-fm-surface-container-low flex-shrink-0">
          <DialogTitle className="text-lg font-semibold text-fm-on-surface">
            Registrar requerimiento
          </DialogTitle>
          <p className="text-sm text-fm-on-surface-variant mt-0.5">{client.name}</p>
        </DialogHeader>

        <div className="px-6 pt-4 pb-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          {/* Pool unificado banner — solo Plan Licencia de Contenido Avanzada */}
          {isUnifiedPool && poolUsage && (
            <div className="rounded-xl bg-fm-primary/5 border border-fm-primary/20 p-4 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-fm-primary">
                  Contenidos del paquete
                </p>
                <p className="text-2xl font-black text-fm-on-surface mt-0.5 tabular-nums">
                  {poolUsage.used}{' '}
                  <span className="text-base font-medium text-fm-outline">/ {poolUsage.limit}</span>
                </p>
              </div>
              <p className="text-xs font-bold text-fm-primary">
                {Math.max(0, poolUsage.limit - poolUsage.used)} disponibles
              </p>
            </div>
          )}

          {/* Type selector */}
          <div>
            <Label className="text-sm font-medium text-fm-on-surface mb-2 block">
              Tipo de contenido
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {activeTypes.map((type) => {
                const consumed = totals[type]
                const planLimit = limits[type] ?? 0
                const credits = availableCredits[type] ?? 0
                const totalAvailable = planLimit + credits
                const atLimit = consumed >= totalAvailable
                const isSelected = selectedType === type
                const isTippableInPool = isUnifiedPool && TIPPABLE_CONTENT_TYPES.includes(type)
                // Etiqueta del contador:
                //   - Pool unificado (tippable): sin contador (el pool se muestra arriba)
                //   - Solo créditos (sin plan): "+N créditos"
                //   - Solo plan: "consumido/limite"
                //   - Mixto: "consumido/limite (+N)"
                const counterLabel = isTippableInPool
                  ? ''
                  : planLimit === 0 && credits > 0
                    ? `+${credits} crédito${credits === 1 ? '' : 's'}`
                    : credits > 0
                      ? `${consumed}/${planLimit} (+${credits})`
                      : `${consumed}/${planLimit}`

                // En pool unificado, el atLimit visual de tippables se basa en el pool global.
                const visualAtLimit = isTippableInPool
                  ? (poolUsage?.used ?? 0) >= (poolUsage?.limit ?? 0)
                  : atLimit

                return (
                  <button
                    key={type}
                    onClick={() => setSelectedType(type)}
                    className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all text-center ${
                      isSelected
                        ? 'border-fm-primary bg-fm-primary/5 text-fm-primary'
                        : visualAtLimit
                        ? 'border-fm-error/30 bg-fm-error/5 text-fm-error/70'
                        : 'border-fm-surface-container-high bg-fm-surface-container-lowest text-fm-on-surface-variant hover:border-fm-primary/40'
                    }`}
                  >
                    <span>{CONTENT_ICONS[type]}</span>
                    <span className="text-xs font-medium leading-tight">
                      {CONTENT_TYPE_LABELS[type]}
                    </span>
                    {counterLabel && (
                      <span className={`text-xs font-semibold ${visualAtLimit ? 'text-fm-error' : ''}`}>
                        {counterLabel}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* At-limit warning */}
          {selectedAtLimit && (
            <div className="bg-fm-error/5 border border-fm-error/20 rounded-xl p-3">
              <p className="text-sm text-fm-error font-medium mb-1">
                {isUnifiedPool ? 'Paquete completo' : 'Límite alcanzado'}
              </p>
              <p className="text-xs text-fm-error/80 mb-2">
                {isUnifiedPool
                  ? 'El paquete de contenidos del cliente está completo. Contrata otro paquete o anula un requerimiento existente.'
                  : 'Este tipo de contenido ha alcanzado su límite mensual.'}
                {isAdmin && ' Como admin, puedes forzar el registro (quedará marcado como excedente).'}
              </p>
              {isAdmin && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={forceOverLimit}
                    onChange={(e) => setForceOverLimit(e.target.checked)}
                    className="rounded border-fm-error/30 accent-fm-error"
                  />
                  <span className="text-xs font-medium text-fm-error">
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
                <Label htmlFor="title" className="text-sm font-medium text-fm-on-surface mb-1.5 block">
                  Título{!isSimpleType && <span className="text-fm-error"> *</span>}
                </Label>
                <input
                  id="title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={isSimpleType ? 'Título (opcional)' : 'Ej. Reel de lanzamiento mayo'}
                  className="w-full px-3 py-2 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl focus:outline-none focus:border-fm-primary text-fm-on-surface"
                />
              </div>
              <div>
                <Label htmlFor="notes" className="text-sm font-medium text-fm-on-surface mb-1.5 block">
                  Notas <span className="text-fm-outline font-normal">(opcional)</span>
                </Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Descripción del contenido, cliente, etc."
                  className="resize-none bg-fm-background border-fm-surface-container-high focus:border-fm-primary focus:ring-fm-primary/20 rounded-xl"
                  rows={3}
                />
              </div>

              {/* Priority — oculto para reunion/produccion */}
              {!isScheduledType && (
                <div>
                  <Label className="text-sm font-medium text-fm-on-surface mb-1.5 block">Prioridad</Label>
                  <div className="flex gap-2">
                    {(['baja', 'media', 'alta'] as Priority[]).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPriority(p)}
                        className={`flex-1 py-2 rounded-xl text-sm font-bold border-2 transition-all flex items-center justify-center gap-1.5 ${
                          priority === p ? 'border-current' : 'border-fm-surface-container-high text-fm-on-surface-variant'
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
              )}

              {/* Fecha y hora (reunion/produccion) o deadline (artes) */}
              {isScheduledType ? (
                <div>
                  <Label htmlFor="starts-at" className="text-sm font-medium text-fm-on-surface mb-1.5 block">
                    Fecha y hora <span className="text-fm-error">*</span>
                  </Label>
                  <input
                    id="starts-at"
                    type="datetime-local"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl focus:outline-none focus:border-fm-primary text-fm-on-surface"
                  />
                </div>
              ) : (
                <div>
                  <Label htmlFor="deadline" className="text-sm font-medium text-fm-on-surface mb-1.5 block">
                    Fecha de entrega <span className="text-fm-error">*</span>
                  </Label>
                  <input
                    id="deadline"
                    type="date"
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl focus:outline-none focus:border-fm-primary text-fm-on-surface"
                  />
                </div>
              )}

              {/* Tiempo estimado: horas + minutos. Obligatorio siempre. */}
              <div>
                <Label className="text-sm font-medium text-fm-on-surface mb-1.5 block">
                  {isScheduledType ? 'Duración' : 'Tiempo estimado'}{' '}
                  <span className="text-fm-error">*</span>
                </Label>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      id="est-hours"
                      type="number"
                      min="0"
                      value={estHours}
                      onChange={(e) => setEstHours(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 pr-10 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl focus:outline-none focus:border-fm-primary text-fm-on-surface"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fm-outline font-medium pointer-events-none">h</span>
                  </div>
                  <div className="flex-1 relative">
                    <input
                      id="est-mins"
                      type="number"
                      min="0"
                      max="59"
                      value={estMinsField}
                      onChange={(e) => setEstMinsField(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 pr-12 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl focus:outline-none focus:border-fm-primary text-fm-on-surface"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fm-outline font-medium pointer-events-none">min</span>
                  </div>
                </div>
              </div>

              {/* Includes story switch — solo tipos aplicables */}
              {storyApplicable && (
                <div className="flex items-start gap-3 p-3 bg-fm-background rounded-xl border border-fm-surface-container-high">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={includesStory}
                    onClick={() => setIncludesStory(!includesStory)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors mt-0.5 ${
                      includesStory ? 'bg-fm-primary' : 'bg-fm-outline-variant'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-fm-surface-container-lowest shadow transition-transform ${
                        includesStory ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-fm-on-surface">Incluye story</p>
                    <p className="text-xs text-fm-outline mt-0.5">
                      Suma 1 a historias sin crear un requerimiento aparte. Desactívalo si la story requiere producción propia.
                    </p>
                  </div>
                </div>
              )}

              {/* Assign to — multi-select checkboxes for admin/supervisor */}
              {canAssign && assignableUsers.length > 0 && (
                <div>
                  <Label className="text-sm font-medium text-fm-on-surface mb-1.5 block">
                    Asignar a <span className="text-fm-outline font-normal">(opcional)</span>
                  </Label>
                  <div className="bg-fm-background border border-fm-surface-container-high rounded-xl px-3 py-2 space-y-1.5 max-h-32 overflow-y-auto">
                    {assignableUsers.map((u) => {
                      const checked = assignedTo.includes(u.id)
                      return (
                        <label key={u.id} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setAssignedTo(prev =>
                              checked ? prev.filter(id => id !== u.id) : [...prev, u.id]
                            )}
                            className="rounded accent-fm-primary"
                          />
                          <span className="text-sm text-fm-on-surface">{u.full_name}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Sección admin: consumo personalizado (multi-tipo) */}
          {selectedType && isStrictAdmin && !isScheduledType && (
            <div className="bg-fm-background rounded-xl border border-fm-surface-container-high overflow-hidden">
              <button
                type="button"
                onClick={() => setOverridesOpen((v) => !v)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-fm-surface-container-low transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="material-symbols-outlined text-fm-secondary text-base">balance</span>
                  <span className="text-sm font-semibold text-fm-on-surface">
                    Consumo personalizado <span className="text-fm-outline font-normal">(admin)</span>
                  </span>
                  {Object.values(consumptionOverrides).some((v) => (v ?? 0) > 0) && (
                    <span className="px-2 py-0.5 bg-fm-secondary/15 text-fm-secondary text-[10px] font-extrabold rounded-full uppercase tracking-wider">
                      Activo
                    </span>
                  )}
                </div>
                <span className={`material-symbols-outlined text-fm-on-surface-variant text-base transition-transform ${overridesOpen ? 'rotate-180' : ''}`}>
                  expand_more
                </span>
              </button>
              {overridesOpen && (
                <div className="px-3 pb-3 pt-1 space-y-2 border-t border-fm-surface-container-high">
                  <p className="text-xs text-fm-outline">
                    Define cuánto descuenta este requerimiento del paquete. Si dejas todo en 0,
                    se usará el consumo normal (1 del tipo seleccionado).
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {activeTypes.map((type) => {
                      const val = consumptionOverrides[type] ?? 0
                      return (
                        <label key={type} className="flex items-center gap-2 px-2 py-1.5 bg-fm-surface-container-lowest rounded-lg border border-fm-surface-container-high">
                          <span className="text-xs text-fm-on-surface-variant flex-1 truncate">
                            {CONTENT_TYPE_LABELS[type]}
                          </span>
                          <input
                            type="number"
                            min="0"
                            value={val === 0 ? '' : val}
                            onChange={(e) => {
                              const n = e.target.value === '' ? 0 : parseInt(e.target.value, 10)
                              setOverrideQty(type, isNaN(n) ? 0 : n)
                            }}
                            placeholder="0"
                            className="w-14 px-2 py-1 text-sm text-right bg-fm-background border border-fm-surface-container-high rounded focus:outline-none focus:border-fm-primary text-fm-on-surface"
                          />
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Impact preview (usa el effectiveBreakdown computado arriba) */}
          {selectedType && (
            <div className="bg-fm-background rounded-xl p-3 space-y-1">
              {/* Pool unificado: una sola línea con el pool global */}
              {isUnifiedPool && poolUsage && tippableSumInBreakdown > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-fm-on-surface-variant">Paquete (contenidos)</span>
                  <span className="text-sm font-semibold text-fm-on-surface">
                    {poolUsage.used} →{' '}
                    <span className={poolWouldOverflow ? 'text-fm-error' : 'text-fm-primary'}>
                      {poolUsage.used + tippableSumInBreakdown}
                    </span>
                    <span className="text-fm-on-surface-variant font-normal"> /{poolUsage.limit}</span>
                  </span>
                </div>
              )}
              {/* Tipos no tippables (historia, matriz, produccion, reunion) o plan normal */}
              {(Object.entries(effectiveBreakdown) as [ContentType, number][])
                .filter(([type]) => !(isUnifiedPool && TIPPABLE_CONTENT_TYPES.includes(type)))
                .map(([type, qty], idx) => {
                const isFirst = idx === 0 && !(isUnifiedPool && tippableSumInBreakdown > 0)
                const next = (totals[type] ?? 0) + qty
                const effectiveLimit = limitsWithCredits[type] ?? 0
                const overLimit = next > effectiveLimit
                const hasCredit = (availableCredits[type] ?? 0) > 0
                return (
                  <div
                    key={type}
                    className={`flex items-center justify-between ${
                      isFirst ? '' : 'pt-1 border-t border-fm-surface-container-high/60'
                    }`}
                  >
                    <span className="text-sm text-fm-on-surface-variant">
                      {CONTENT_TYPE_LABELS[type]}
                      {qty > 1 && <span className="ml-1 text-fm-secondary font-bold">×{qty}</span>}
                      {hasCredit && <span className="ml-1 text-[10px] text-fm-primary font-semibold">(crédito)</span>}
                    </span>
                    <span className="text-sm font-semibold text-fm-on-surface">
                      {totals[type] ?? 0} →{' '}
                      <span className={overLimit ? 'text-fm-error' : 'text-fm-primary'}>{next}</span>
                      <span className="text-fm-on-surface-variant font-normal"> /{effectiveLimit}</span>
                    </span>
                  </div>
                )
              })}
              {selectedType === 'reunion' && cycle.limits_snapshot_json.reunion_duracion_horas && (
                <p className="text-xs text-fm-outline pt-1 border-t border-fm-surface-container-high/60">
                  Duración por reunión: <span className="font-semibold">{cycle.limits_snapshot_json.reunion_duracion_horas}h</span>
                </p>
              )}
            </div>
          )}

        </div>

        {/* Footer fijo */}
        <div className="px-6 py-4 border-t border-fm-surface-container-low flex-shrink-0 space-y-3">
          {error && (
            <p className="text-sm text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              className="flex-1 rounded-xl border-fm-surface-container-high text-fm-on-surface-variant"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                !selectedType ||
                loading ||
                (!title.trim() && !isSimpleType) ||
                (selectedAtLimit && !forceOverLimit) ||
                (isScheduledType && (!startsAt || (!estHours.trim() && !estMinsField.trim()))) ||
                (!isScheduledType && selectedType !== null && (!deadline.trim() || (!estHours.trim() && !estMinsField.trim())))
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
