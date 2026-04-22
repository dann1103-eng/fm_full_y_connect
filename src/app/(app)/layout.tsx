import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileSidebar } from '@/components/layout/MobileSidebar'
import { MobileSidebarProvider } from '@/components/layout/MobileSidebarProvider'
import { UserProvider } from '@/contexts/UserContext'
import { NotificationToastHost } from '@/components/notifications/NotificationToastHost'
import { FloatingChatDock } from '@/components/inbox/floating/FloatingChatDock'

interface AppLayoutProps {
  children: React.ReactNode
}

async function getPendingRenewalsCount(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<number> {
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]

  const { count } = await supabase
    .from('billing_cycles')
    .select('*', { count: 'exact', head: true })
    .in('status', ['current', 'pending_renewal'])
    .lte('period_end', in7Days)

  return count ?? 0
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const supabase = await createClient()
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser()

  if (!authUser) redirect('/login')

  const { data: appUser } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .single()

  if (!appUser) redirect('/login')

  const renewalCount = await getPendingRenewalsCount(supabase)

  const { data: logoSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'agency_logo_url')
    .single()
  const agencyLogoUrl = logoSetting?.value ?? null

  return (
    <UserProvider user={appUser}>
      <MobileSidebarProvider>
        <div className="flex h-screen overflow-hidden bg-fm-background">
          <Sidebar renewalCount={renewalCount} agencyLogoUrl={agencyLogoUrl} />
          <MobileSidebar renewalCount={renewalCount} agencyLogoUrl={agencyLogoUrl} />
          <div className="flex flex-col flex-1 md:ml-64 overflow-hidden">
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </div>
        <NotificationToastHost />
        <FloatingChatDock />
      </MobileSidebarProvider>
    </UserProvider>
  )
}
