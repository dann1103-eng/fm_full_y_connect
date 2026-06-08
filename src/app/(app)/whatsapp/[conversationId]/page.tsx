export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { createWaAdminClient as createAdminClient } from '@/lib/whatsapp/db'
import { WaChat } from '@/components/whatsapp/WaChat'
import type { WaConversation, WaMessage } from '@/types/db'

interface PageProps {
  params: Promise<{ conversationId: string }>
}

export default async function WhatsappConversationPage({ params }: PageProps) {
  const ctx = await getEffectiveUser()
  if (!ctx) redirect('/login')
  if (ctx.appUser.role === 'client') redirect('/portal/dashboard')

  const { conversationId } = await params
  const admin = createAdminClient()

  const [convRes, msgsRes, clientsRes, leadRes] = await Promise.all([
    admin.from('wa_conversations').select('*').eq('id', conversationId).maybeSingle(),
    admin
      .from('wa_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(200),
    admin.from('clients').select('id, name').order('name', { ascending: true }),
    admin.from('wa_leads').select('*').eq('conversation_id', conversationId).maybeSingle(),
  ])

  if (!convRes.data) notFound()
  const conversation = convRes.data as WaConversation
  const messages = (msgsRes.data ?? []) as WaMessage[]
  const clients = (clientsRes.data ?? []) as Array<{ id: string; name: string }>
  const lead = (leadRes.data as {
    id: string
    company_name: string | null
    contact_name: string | null
    interest: string | null
    budget_range: string | null
    urgency: string | null
    notes: string | null
    updated_at: string
  } | null) ?? null

  let linkedClient: { id: string; name: string } | null = null
  if (conversation.client_id) {
    linkedClient = clients.find((c) => c.id === conversation.client_id) ?? null
  }

  return (
    <WaChat
      conversation={conversation}
      initialMessages={messages}
      clients={clients}
      linkedClient={linkedClient}
      lead={lead}
    />
  )
}
