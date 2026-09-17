import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { canManageMatrices } from '@/lib/domain/permissions'
import { TopNav } from '@/components/layout/TopNav'
import { loadMatricesList, loadMissingMatrices } from '@/lib/data/matrices'
import { MatricesPageClient } from '@/components/matrices/MatricesPageClient'
import type { Client } from '@/types/db'

export const dynamic = 'force-dynamic'

/** "2025-09-16" → "16 de septiembre de 2025" (fecha pura: se formatea en UTC para no correr el día). */
function readableDate(d: string): string {
  return new Intl.DateTimeFormat('es-SV', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${d}T00:00:00Z`))
}

export default async function MatricesPage() {
  const ctx = await getEffectiveUser()
  if (!ctx) redirect('/login')
  if (!canManageMatrices(ctx.appUser.role)) redirect('/dashboard')

  const supabase = await createClient()
  const [list, missing, clientsRes] = await Promise.all([
    loadMatricesList(supabase),
    loadMissingMatrices(supabase),
    // Todos los clientes: el filtro de la tabla debe poder elegir cualquiera con matrices (también inactivos).
    // El diálogo de creación recibe solo los operativos (ver MatricesPageClient).
    supabase.from('clients').select('*').order('name'),
  ])
  // Igual que los loaders: un error de consulta muestra el error boundary, no un diálogo sin clientes.
  if (clientsRes.error) throw new Error(`MatricesPage clients: ${clientsRes.error.message}`)

  return (
    <div className="flex flex-col min-h-full">
      <TopNav title="Matrices" />
      <div className="flex-1 p-3 sm:p-6 space-y-4 sm:space-y-6 max-w-6xl mx-auto w-full">
        <MatricesPageClient rows={list.rows} missing={missing} clients={(clientsRes.data ?? []) as Client[]} />
        <div className="space-y-0.5 px-1">
          <p className="text-xs text-fm-on-surface-variant">
            Mostrando matrices con período desde {readableDate(list.since)}.
          </p>
          {list.truncated && (
            <p className="text-xs text-fm-on-surface-variant">Hay más matrices de las que se muestran; usa los filtros.</p>
          )}
        </div>
      </div>
    </div>
  )
}
