import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientId } from '@/lib/supabase/active-client'
import { computeTotals } from '@/lib/domain/requirement'
import { effectiveLimits, applyContentLimitsWithOverride, CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import { daysUntilEnd } from '@/lib/domain/cycles'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { BillingCycle, Requirement } from '@/types/db'

export default async function PortalDashboardPage() {
  const activeId = await getActiveClientId()
  if (!activeId) redirect('/portal/seleccionar-marca')

  const supabase = await createClient()

  // Datos del cliente
  const { data: client } = await supabase
    .from('clients')
    .select('id, name, status')
    .eq('id', activeId)
    .single()

  // Ciclo actual
  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('*')
    .eq('client_id', activeId)
    .eq('status', 'current')
    .maybeSingle()

  const currentCycle = cycle as BillingCycle | null

  // Requerimientos del ciclo actual
  const { data: reqs } = currentCycle
    ? await supabase
        .from('requirements')
        .select('id, content_type, phase, voided, deadline, title')
        .eq('billing_cycle_id', currentCycle.id)
        .eq('voided', false)
        .order('deadline', { ascending: true, nullsFirst: false })
    : { data: [] }

  const requirements = (reqs ?? []) as Pick<Requirement, 'id' | 'content_type' | 'phase' | 'voided' | 'deadline' | 'title'>[]
  const totals = computeTotals(requirements as unknown as Requirement[])

  const baseLimits = currentCycle
    ? effectiveLimits(currentCycle.limits_snapshot_json, currentCycle.rollover_from_previous_json)
    : null
  const limits = baseLimits && currentCycle
    ? applyContentLimitsWithOverride(baseLimits, currentCycle.content_limits_override_json)
    : baseLimits

  const daysLeft = currentCycle ? daysUntilEnd(currentCycle.period_end) : null

  // Próximos deadlines (los 5 más cercanos con deadline futuro)
  const today = new Date().toISOString().split('T')[0]
  const upcoming = requirements
    .filter((r) => r.deadline && r.deadline >= today)
    .slice(0, 5)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fm-on-surface mb-1">
          {client?.name ?? 'Mi empresa'}
        </h1>
        <p className="text-sm text-fm-on-surface-variant">
          {currentCycle
            ? `Ciclo ${format(new Date(currentCycle.period_start), 'dd MMM', { locale: es })} – ${format(new Date(currentCycle.period_end), 'dd MMM yyyy', { locale: es })}`
            : 'Sin ciclo activo'}
          {daysLeft !== null && (
            <span className={`ml-2 font-medium ${daysLeft <= 7 ? 'text-fm-error' : 'text-fm-primary'}`}>
              · {daysLeft} día{daysLeft !== 1 ? 's' : ''} restante{daysLeft !== 1 ? 's' : ''}
            </span>
          )}
        </p>
      </div>

      {/* Progreso por tipo de contenido */}
      {limits && Object.keys(limits).length > 0 && (
        <section className="glass-panel p-5">
          <h2 className="text-base font-semibold text-fm-on-surface mb-4">Progreso del ciclo</h2>
          <div className="space-y-3">
            {Object.entries(limits)
              .filter(([, max]) => (max as number) > 0)
              .map(([type, max]) => {
                const used = (totals as Record<string, number>)[type] ?? 0
                const pct = Math.min(100, Math.round((used / (max as number)) * 100))
                return (
                  <div key={type}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-fm-on-surface-variant">
                        {CONTENT_TYPE_LABELS[type as keyof typeof CONTENT_TYPE_LABELS] ?? type}
                      </span>
                      <span className="text-fm-on-surface font-medium">
                        {used} / {max as number}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-fm-outline-variant/20">
                      <div
                        className="h-2 rounded-full bg-fm-primary transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
          </div>
        </section>
      )}

      {/* Próximos deadlines */}
      {upcoming.length > 0 && (
        <section className="glass-panel p-5">
          <h2 className="text-base font-semibold text-fm-on-surface mb-4">Próximos deadlines</h2>
          <div className="space-y-2">
            {upcoming.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <span className="text-fm-on-surface truncate max-w-[70%]">
                  {r.title || CONTENT_TYPE_LABELS[r.content_type as keyof typeof CONTENT_TYPE_LABELS] || r.content_type}
                </span>
                <span className="text-fm-on-surface-variant flex-shrink-0">
                  {r.deadline ? format(new Date(r.deadline), 'dd MMM', { locale: es }) : '—'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!currentCycle && (
        <div className="glass-panel p-8 text-center text-fm-on-surface-variant">
          <p className="text-sm">No hay ciclo activo en este momento.</p>
        </div>
      )}
    </div>
  )
}
