export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { createWaAdminClient as createAdminClient } from '@/lib/whatsapp/db'
import { TopNav } from '@/components/layout/TopNav'
import { WaResponsiveShell } from '@/components/whatsapp/WaResponsiveShell'
import { WaSidebar } from '@/components/whatsapp/WaSidebar'
import type { WaConversation } from '@/types/db'

interface ConvWithClient extends WaConversation {
  client?: { id: string; name: string } | null
}

async function loadConversations(): Promise<ConvWithClient[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('wa_conversations')
    .select('*, client:clients(id, name)')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(200)
  if (error) {
    console.error('[whatsapp layout] loadConversations failed', error)
    return []
  }
  return (data ?? []) as unknown as ConvWithClient[]
}

export default async function WhatsappLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getEffectiveUser()
  if (!ctx) redirect('/login')
  if (ctx.appUser.role === 'client') redirect('/portal/dashboard')

  const conversations = await loadConversations()

  return (
    <div className="flex flex-col h-full">
      <TopNav title="WhatsApp" />
      <div className="flex-1 min-h-0">
        <WaResponsiveShell sidebar={<WaSidebar initial={conversations} />}>
          {children}
        </WaResponsiveShell>
      </div>
    </div>
  )
}
