import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, limitsToRecord } from '@/lib/domain/plans'
import type { Plan } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function PlansPage() {
  const supabase = await createClient()

  const { data: { user: authUser } } = await supabase.auth.getUser()
  const { data: appUser } = authUser
    ? await supabase.from('users').select('role').eq('id', authUser.id).single()
    : { data: null }
  const isAdmin = appUser?.role === 'admin'

  const { data: plans } = await supabase
    .from('plans')
    .select('*')
    .order('price_usd')

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Planes" />

      <div className="flex-1 p-6 space-y-5">
        {!isAdmin && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
            Solo los administradores pueden modificar los planes.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {(plans ?? []).map((plan: Plan) => {
            const limits = limitsToRecord(plan.limits_json)
            return (
              <div
                key={plan.id}
                className={`bg-white rounded-2xl border p-6 ${
                  !plan.active ? 'opacity-60 border-[#abadaf]/20' : 'border-[#abadaf]/20'
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-[#2c2f31]">{plan.name}</h3>
                    <p className="text-2xl font-bold text-[#00675c] mt-1">
                      ${plan.price_usd}
                      <span className="text-sm font-normal text-[#595c5e]">/mes</span>
                    </p>
                  </div>
                  {!plan.active && (
                    <span className="text-xs bg-[#abadaf]/20 text-[#747779] px-2 py-0.5 rounded-full">
                      Inactivo
                    </span>
                  )}
                </div>

                <div className="space-y-2 border-t border-[#abadaf]/10 pt-4">
                  {CONTENT_TYPES.filter((t) => t !== 'reunion' && t !== 'produccion').map((type) => (
                    <div key={type} className="flex items-center justify-between">
                      <span className="text-sm text-[#595c5e]">{CONTENT_TYPE_LABELS[type]}</span>
                      <span
                        className={`text-sm font-semibold ${
                          limits[type] === 0 ? 'text-[#abadaf]' : 'text-[#2c2f31]'
                        }`}
                      >
                        {limits[type] === 0 ? '—' : limits[type]}
                      </span>
                    </div>
                  ))}

                  {/* Producciones — solo conteo, sin pipeline de fases */}
                  {limits['produccion'] > 0 && (
                    <div className="flex items-center justify-between pt-1 border-t border-[#abadaf]/10 mt-1">
                      <span className="text-sm text-[#595c5e] flex items-center gap-1.5">
                        Producciones
                        <span className="text-[10px] font-semibold bg-[#abadaf]/15 text-[#747779] px-1.5 py-0.5 rounded-full">
                          solo conteo
                        </span>
                      </span>
                      <span className="text-sm font-semibold text-[#2c2f31]">
                        {limits['produccion']}
                      </span>
                    </div>
                  )}

                  {/* Reuniones — con duración desglosada */}
                  {limits['reunion'] > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#595c5e]">Reuniones</span>
                      <span className="text-sm font-semibold text-[#2c2f31]">
                        {limits['reunion']}
                        {plan.limits_json.reunion_duracion_horas
                          ? <span className="text-xs font-normal text-[#595c5e]"> × {plan.limits_json.reunion_duracion_horas}h</span>
                          : null}
                      </span>
                    </div>
                  )}
                  {limits['reunion'] === 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[#595c5e]">Reuniones</span>
                      <span className="text-sm font-semibold text-[#abadaf]">—</span>
                    </div>
                  )}
                </div>

                <p className="text-xs text-[#747779] mt-4 bg-[#f5f7f9] rounded-lg px-3 py-2">
                  Los cambios al catálogo no afectan ciclos activos (snapshot).
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
