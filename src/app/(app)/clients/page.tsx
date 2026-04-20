import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { TopNav } from '@/components/layout/TopNav'
import { ClientForm } from '@/components/clients/ClientForm'
import type { ClientWithPlan } from '@/types/db'

export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<string, string> = {
  active: 'Activo',
  paused: 'Pausado',
  overdue: 'Moroso',
}
const STATUS_COLORS: Record<string, string> = {
  active: 'bg-[#00675c]/10 text-[#00675c]',
  paused: 'bg-[#595c5e]/10 text-[#595c5e]',
  overdue: 'bg-[#b31b25]/10 text-[#b31b25]',
}

const avatarGradients = [
  'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)',
  'linear-gradient(135deg, #4a6319 0%, #ceee93 100%)',
  'linear-gradient(135deg, #006385 0%, #1dc0fe 100%)',
  'linear-gradient(135deg, #5c4a8a 0%, #b89cff 100%)',
  'linear-gradient(135deg, #7a4f00 0%, #ffcc5c 100%)',
]
function clientGradient(name: string) {
  return avatarGradients[name.charCodeAt(0) % avatarGradients.length]
}
function getInitials(name: string) {
  return name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
}

export default async function ClientsPage() {
  const supabase = await createClient()

  const { data: authUser } = await supabase.auth.getUser()
  const { data: appUser } = authUser.user
    ? await supabase.from('users').select('role').eq('id', authUser.user.id).single()
    : { data: null }
  const isAdmin = appUser?.role === 'admin'
  const canCreate = appUser?.role === 'admin' || appUser?.role === 'supervisor'

  const { data: clients } = await supabase
    .from('clients')
    .select('*, plan:plans(*)')
    .order('name')

  const { data: plans } = await supabase
    .from('plans')
    .select('id, name, price_usd')
    .eq('active', true)

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Clientes" />

      <div className="flex-1 p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-[#595c5e]">
            {clients?.length ?? 0} cliente{clients?.length !== 1 ? 's' : ''} registrado{clients?.length !== 1 ? 's' : ''}
          </p>
          {canCreate && <ClientForm plans={plans ?? []} />}
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-[#abadaf]/20 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#abadaf]/10">
                <th className="text-left text-xs font-semibold text-[#747779] px-5 py-3">Cliente</th>
                <th className="text-left text-xs font-semibold text-[#747779] px-4 py-3">Plan</th>
                <th className="text-left text-xs font-semibold text-[#747779] px-4 py-3">Estado</th>
                <th className="text-left text-xs font-semibold text-[#747779] px-4 py-3">Día de facturación</th>
                <th className="text-left text-xs font-semibold text-[#747779] px-4 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#abadaf]/10">
              {(clients ?? []).map((clientRaw) => {
                const client = clientRaw as ClientWithPlan
                return (
                  <tr key={client.id} className="hover:bg-[#f5f7f9] transition-colors">
                    <td className="px-5 py-3">
                      <Link
                        href={`/clients/${client.id}`}
                        className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                      >
                        {client.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={client.logo_url} alt={client.name} className="w-8 h-8 rounded-lg object-cover" />
                        ) : (
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                            style={{ background: clientGradient(client.name) }}
                          >
                            {getInitials(client.name)}
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium text-[#2c2f31]">{client.name}</p>
                          {client.contact_email && (
                            <p className="text-xs text-[#747779]">{client.contact_email}</p>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-[#2c2f31]">{client.plan.name}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[client.status]}`}>
                        {STATUS_LABELS[client.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-[#595c5e]">Día {client.billing_day}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/clients/${client.id}`}
                        className="text-xs text-[#00675c] hover:underline font-medium"
                      >
                        Ver →
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {(!clients || clients.length === 0) && (
            <div className="text-center py-10 text-[#595c5e] text-sm">
              No hay clientes registrados.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
