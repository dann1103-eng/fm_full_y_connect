import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TopNav } from '@/components/layout/TopNav'
import { CalendarPageClient } from './CalendarPageClient'
import type { AppUser } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function CalendarioPage() {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) redirect('/login')

  const { data: appUser } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .single()
  if (!appUser) redirect('/login')

  const isPrivileged = appUser.role === 'admin' || appUser.role === 'supervisor'

  // Usuarios asignables (para modal de reunión interna)
  const { data: allUsers } = await supabase
    .from('users')
    .select('id, full_name, avatar_url')
    .order('full_name')

  // Clientes activos (para filtros)
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name')
    .eq('status', 'active')
    .order('name')

  return (
    <div className="flex flex-col h-screen bg-fm-background">
      <TopNav title="Calendario" />
      <div className="flex-1 overflow-hidden">
        <CalendarPageClient
          currentUser={appUser as AppUser}
          isPrivileged={isPrivileged}
          allUsers={allUsers ?? []}
          clients={clients ?? []}
        />
      </div>
    </div>
  )
}
