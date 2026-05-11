import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { Sidebar } from '@/components/layout/Sidebar'
import { MobileSidebar } from '@/components/layout/MobileSidebar'
import { MobileSidebarProvider } from '@/components/layout/MobileSidebarProvider'
import { UserProvider } from '@/contexts/UserContext'
import { NotificationToastHost } from '@/components/notifications/NotificationToastHost'
import { FloatingChatDock } from '@/components/inbox/floating/FloatingChatDock'
import { CallDock } from '@/components/calls/CallDock'
import { IncomingCallToast } from '@/components/calls/IncomingCallToast'
import { TeamShiftNotificationHost } from '@/components/layout/TeamShiftNotificationHost'
import { ActiveCallProvider } from '@/contexts/ActiveCallContext'
import { LoginWelcomeDialog } from '@/components/layout/LoginWelcomeDialog'
import { IdleSchedulerWrapper } from '@/components/layout/IdleSchedulerWrapper'
import { SessionSentinel } from '@/components/auth/SessionSentinel'
import { SpectatorBanner } from '@/components/layout/SpectatorBanner'

interface AppLayoutProps {
  children: React.ReactNode
}

async function getPendingRenewalsCount(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<number> {
  const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]

  const { count } = await supabase
    .from('billing_cycles')
    .select('*', { count: 'exact', head: true })
    .in('status', ['current', 'pending_renewal'])
    .lte('period_end', in3Days)

  return count ?? 0
}

export default async function AppLayout({ children }: AppLayoutProps) {
  const ctx = await getEffectiveUser()
  if (!ctx) redirect('/login')

  // Cliente real (sin suplantación) → portal
  if (!ctx.isImpersonating && ctx.realAppUser.role === 'client') {
    redirect('/portal/dashboard')
  }
  // Admin suplantando a un cliente → portal
  if (ctx.isImpersonating && ctx.appUser.role === 'client') {
    redirect('/portal/dashboard')
  }

  const supabase = await createClient()
  const renewalCount = await getPendingRenewalsCount(supabase)

  const { data: logoSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'agency_logo_url')
    .single()
  const agencyLogoUrl = logoSetting?.value ?? null

  return (
    <UserProvider
      user={ctx.appUser}
      isImpersonating={ctx.isImpersonating}
      realAdminName={ctx.isImpersonating ? ctx.realAppUser.full_name : null}
    >
      <ActiveCallProvider>
        <MobileSidebarProvider>
          <SpectatorBanner />
          <div className="flex h-screen overflow-hidden bg-fm-background">
            <Sidebar renewalCount={renewalCount} agencyLogoUrl={agencyLogoUrl} />
            <MobileSidebar renewalCount={renewalCount} agencyLogoUrl={agencyLogoUrl} />
            <div className="flex flex-col flex-1 md:ml-64 overflow-hidden">
              <main className="flex-1 overflow-y-auto">{children}</main>
            </div>
          </div>
          <NotificationToastHost />
          <FloatingChatDock />
          <CallDock />
          <IncomingCallToast />
          <TeamShiftNotificationHost />
          <LoginWelcomeDialog />
          <IdleSchedulerWrapper />
          <SessionSentinel />
        </MobileSidebarProvider>
      </ActiveCallProvider>
    </UserProvider>
  )
}
