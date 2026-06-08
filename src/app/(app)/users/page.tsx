import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { AppUser } from '@/types/db'
import { UsersTable } from './UsersTable'
import { TopNav } from '@/components/layout/TopNav'

export default async function UsersPage() {
  const supabase = await createClient()

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser()
  if (!authUser) redirect('/login')

  const { data: appUser } = await supabase
    .from('users')
    .select('role')
    .eq('id', authUser.id)
    .single()
  if (appUser?.role !== 'admin') redirect('/')

  // select('*') + filtro en JS (en vez de .is('deactivated_at', null)) para ser
  // resilientes a si la migración 0105 aún no se aplicó: si la columna no existe,
  // `u.deactivated_at` es undefined y el usuario se conserva (no rompe la lista).
  const { data: usersRaw } = await supabase
    .from('users')
    .select('*')
    .not('role', 'eq', 'client')
    .order('created_at')

  const users = (usersRaw ?? []).filter((u) => !u.deactivated_at)

  return (
    <div className="flex flex-col min-h-full">
      <TopNav title="Usuarios" />
      <div className="p-6 max-w-4xl mx-auto w-full">
        <UsersTable users={users as AppUser[]} currentUserId={authUser.id} />
      </div>
    </div>
  )
}
