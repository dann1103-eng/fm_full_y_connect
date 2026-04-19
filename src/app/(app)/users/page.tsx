import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { AppUser } from '@/types/db'
import { UsersTable } from './UsersTable'

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

  const { data: users } = await supabase
    .from('users')
    .select('id, email, full_name, role, created_at')
    .order('created_at')

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#2c2f31]">Gestión de usuarios</h1>
        <p className="mt-1 text-sm text-[#595c5e]">
          Para crear usuarios nuevos, usar Supabase Dashboard → Authentication → Users.
        </p>
      </div>

      <UsersTable users={(users ?? []) as AppUser[]} currentUserId={authUser.id} />
    </div>
  )
}
