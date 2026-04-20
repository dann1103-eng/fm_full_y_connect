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

  const { data: users } = await supabase
    .from('users')
    .select('id, email, full_name, role, created_at, avatar_url, default_assignee')
    .order('created_at')

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Usuarios" />
      <div className="p-6 max-w-4xl mx-auto w-full">
        <UsersTable users={(users ?? []) as AppUser[]} currentUserId={authUser.id} />
      </div>
    </div>
  )
}
