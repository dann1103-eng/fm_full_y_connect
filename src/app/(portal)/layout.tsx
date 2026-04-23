import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getActiveClientId, getActiveClientIds } from '@/lib/supabase/active-client'
import { PortalSidebar } from '@/components/portal/PortalSidebar'
import { UserProvider } from '@/contexts/UserContext'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) redirect('/login')

  const { data: appUser } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .single()

  if (!appUser) redirect('/login')
  if (appUser.role !== 'client') redirect('/dashboard')

  const ids = await getActiveClientIds()
  if (ids.length === 0) {
    // Cliente sin ninguna marca asignada — cerrar sesión correctamente antes de redirigir.
    // No usar redirect('/auth/signout') porque esa ruta es POST-only y no limpiaría la sesión.
    await supabase.auth.signOut()
    redirect('/login')
  }

  const hdrs = await headers()
  const currentPath = hdrs.get('x-pathname') ?? ''
  const isSelectingBrand = currentPath === '/portal/seleccionar-marca'

  const activeId = await getActiveClientId()
  if (!activeId && !isSelectingBrand) redirect('/portal/seleccionar-marca')

  if (isSelectingBrand && !activeId) {
    return (
      <UserProvider user={appUser}>
        <div className="flex h-screen overflow-hidden bg-fm-background">
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </UserProvider>
    )
  }

  const { data: clientOptions } = await supabase
    .from('clients')
    .select('id, name, logo_url')
    .in('id', ids)

  const active = clientOptions?.find((c) => c.id === activeId)
  const clientDisplayName = active?.name ?? 'Mi empresa'

  return (
    <UserProvider user={appUser}>
      <div className="flex h-screen overflow-hidden bg-fm-background">
        <PortalSidebar
          clientOptions={clientOptions ?? []}
          activeClientId={activeId!}
          clientDisplayName={clientDisplayName}
        />
        <div className="flex flex-col flex-1 md:ml-64 overflow-hidden">
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </UserProvider>
  )
}
