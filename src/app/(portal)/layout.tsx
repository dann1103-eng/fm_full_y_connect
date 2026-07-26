import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientId, getActiveClientIds } from '@/lib/supabase/active-client'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { loadPortalPermissions } from '@/lib/auth/portal-permissions'
import { PortalSidebar } from '@/components/portal/PortalSidebar'
import { PortalTopNav } from '@/components/portal/PortalTopNav'
import { UserProvider } from '@/contexts/UserContext'
import { SessionSentinel } from '@/components/auth/SessionSentinel'
import { SpectatorBanner } from '@/components/layout/SpectatorBanner'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getEffectiveUser()
  if (!ctx) redirect('/login')

  // Solo clientes (reales o suplantados) acceden al portal.
  if (ctx.appUser.role !== 'client') redirect('/dashboard')

  const ids = await getActiveClientIds()
  if (ids.length === 0) {
    // Route Handler puede limpiar cookies; signOut() en Server Component es silenciado.
    if (ctx.isImpersonating) redirect('/users')
    redirect('/auth/signout')
  }

  const hdrs = await headers()
  const currentPath = hdrs.get('x-pathname') ?? ''

  // Con marcas vinculadas, getActiveClientId() siempre resuelve una (la de la
  // cookie o la primera alfabéticamente). El caso de 0 marcas ya se atendió
  // arriba, así que aquí activeId nunca es null. El cambio de marca ocurre en
  // el desplegable del sidebar (ActiveClientSwitcher).
  const activeId = await getActiveClientId()

  const supabase = await createClient()
  // Mismo orden alfabético que getActiveClientIds(), para que el desplegable
  // del sidebar liste las marcas igual que como se elige la marca por defecto.
  const { data: clientOptions } = await supabase
    .from('clients')
    .select('id, name, logo_url')
    .in('id', ids)
    .order('name')

  const active = clientOptions?.find((c) => c.id === activeId)
  const clientDisplayName = active?.name ?? 'Mi empresa'

  // Verificar status del cliente activo. Si está suspendido por impago o
  // desactivado, mostrar banner read-only en todo el portal.
  const { data: activeStatusRow } = await supabase
    .from('clients')
    .select('status')
    .eq('id', activeId!)
    .maybeSingle()
  const isSuspended =
    activeStatusRow?.status === 'inactive_payment' ||
    activeStatusRow?.status === 'inactive_manual'

  const permissions = await loadPortalPermissions(
    ctx.appUser.id,
    activeId!,
    ctx.isImpersonating,
  )

  // Sin ningún permiso → dejarle solo /portal/sin-acceso accesible.
  const isSinAcceso = currentPath === '/portal/sin-acceso'
  if (!permissions.can_billing && !permissions.can_work && !isSinAcceso) {
    redirect('/portal/sin-acceso')
  }

  return (
    <UserProvider
      user={ctx.appUser}
      isImpersonating={ctx.isImpersonating}
      realAdminName={ctx.isImpersonating ? ctx.realAppUser.full_name : null}
    >
      <SpectatorBanner />
      <div className="flex h-screen overflow-hidden bg-fm-background">
        <PortalSidebar
          clientOptions={clientOptions ?? []}
          activeClientId={activeId!}
          clientDisplayName={clientDisplayName}
          permissions={permissions}
        />
        <div className="flex flex-col flex-1 md:ml-64 overflow-hidden">
          <PortalTopNav clientDisplayName={clientDisplayName} />
          {isSuspended && (
            <div className="bg-fm-error/10 border-b border-fm-error/30 px-6 py-3 flex items-center gap-3">
              <span className="material-symbols-outlined text-fm-error text-xl">block</span>
              <p className="text-sm font-bold text-fm-error">
                Tu cuenta está suspendida por falta de pago.
                <span className="font-medium text-fm-error/80 ml-1">
                  No puedes crear nuevas solicitudes. Contacta a tu agencia.
                </span>
              </p>
            </div>
          )}
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
      <SessionSentinel />
    </UserProvider>
  )
}
