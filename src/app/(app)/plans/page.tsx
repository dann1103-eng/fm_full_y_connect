import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, limitsToRecord } from '@/lib/domain/plans'
import { PlansManager, PlanEditButton } from '@/components/plans/PlansManager'
import type { Plan } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function PlansPage() {
  const supabase = await createClient()

  const { data: { user: authUser } } = await supabase.auth.getUser()
  const { data: appUser } = authUser
    ? await supabase.from('users').select('role').eq('id', authUser.id).single()
    : { data: null }
  const isAdmin = appUser?.role === 'admin'
  const canViewPage = appUser?.role === 'admin' || appUser?.role === 'supervisor'
  if (!canViewPage) redirect('/')

  const { data: plans } = await supabase
    .from('plans')
    .select('*')
    .order('price_usd')

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Planes" />

      <div className="flex-1 p-6 space-y-5">
        {/* Header con botón crear (solo admin) */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-fm-on-surface-variant">
            {plans?.length ?? 0} plan{plans?.length !== 1 ? 'es' : ''}
          </p>
          <PlansManager isAdmin={isAdmin} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {(plans ?? []).map((plan: Plan) => {
            const limits = limitsToRecord(plan.limits_json)
            return (
              <div
                key={plan.id}
                className={`bg-fm-surface-container-lowest rounded-2xl border p-6 ${
                  !plan.active ? 'opacity-60 border-fm-outline-variant/20' : 'border-fm-outline-variant/20'
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-fm-on-surface">{plan.name}</h3>
                    <p className="text-2xl font-bold text-fm-primary mt-1">
                      ${plan.price_usd}
                      <span className="text-sm font-normal text-fm-on-surface-variant">/mes</span>
                    </p>
                  </div>
                  {!plan.active && (
                    <span className="text-xs bg-fm-outline-variant/20 text-fm-outline px-2 py-0.5 rounded-full">
                      Inactivo
                    </span>
                  )}
                </div>

                <div className="space-y-2 border-t border-fm-outline-variant/10 pt-4">
                  {CONTENT_TYPES.filter((t) => t !== 'reunion' && t !== 'produccion').map((type) => (
                    <div key={type} className="flex items-center justify-between">
                      <span className="text-sm text-fm-on-surface-variant">{CONTENT_TYPE_LABELS[type]}</span>
                      <span
                        className={`text-sm font-semibold ${
                          limits[type] === 0 ? 'text-fm-outline-variant' : 'text-fm-on-surface'
                        }`}
                      >
                        {limits[type] === 0 ? '—' : limits[type]}
                      </span>
                    </div>
                  ))}

                  {/* Producciones — solo conteo, sin pipeline de fases */}
                  {limits['produccion'] > 0 && (
                    <div className="flex items-center justify-between pt-1 border-t border-fm-outline-variant/10 mt-1">
                      <span className="text-sm text-fm-on-surface-variant flex items-center gap-1.5">
                        Producciones
                        <span className="text-[10px] font-semibold bg-fm-outline-variant/15 text-fm-outline px-1.5 py-0.5 rounded-full">
                          solo conteo
                        </span>
                      </span>
                      <span className="text-sm font-semibold text-fm-on-surface">
                        {limits['produccion']}
                      </span>
                    </div>
                  )}

                  {/* Reuniones — con duración desglosada */}
                  {limits['reunion'] > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-fm-on-surface-variant">Reuniones</span>
                      <span className="text-sm font-semibold text-fm-on-surface">
                        {limits['reunion']}
                        {plan.limits_json.reunion_duracion_horas
                          ? <span className="text-xs font-normal text-fm-on-surface-variant"> × {plan.limits_json.reunion_duracion_horas}h</span>
                          : null}
                      </span>
                    </div>
                  )}
                  {limits['reunion'] === 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-fm-on-surface-variant">Reuniones</span>
                      <span className="text-sm font-semibold text-fm-outline-variant">—</span>
                    </div>
                  )}
                </div>

                <p className="text-xs text-fm-outline mt-4 bg-fm-background rounded-lg px-3 py-2">
                  Los cambios al catálogo no afectan ciclos activos (snapshot).
                </p>

                {isAdmin && (
                  <div className="mt-3 flex justify-end">
                    <PlanEditButton plan={plan} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
