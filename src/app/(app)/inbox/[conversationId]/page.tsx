import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ConversationView } from '@/components/inbox/ConversationView'
import type {
  AppUser,
  Conversation,
  MessageAttachment,
  MessageWithMeta,
} from '@/types/db'

interface PageProps {
  params: Promise<{ conversationId: string }>
}

export default async function ConversationPage({ params }: PageProps) {
  const { conversationId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: appUser } = await supabase
    .from('users')
    .select('id, role')
    .eq('id', user.id)
    .single()
  if (!appUser) notFound()
  const isAdmin = appUser.role === 'admin'

  const { data: convRaw } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single()
  if (!convRaw) notFound()
  const conversation = convRaw as Conversation

  // Miembros
  type MemberRow = {
    user_id: string
    user: { id: string; full_name: string; avatar_url: string | null; role: AppUser['role'] } | null
  }
  const { data: membersRaw } = await supabase
    .from('conversation_members')
    .select('user_id, user:users!conversation_members_user_id_fkey(id, full_name, avatar_url, role)')
    .eq('conversation_id', conversationId)
  const members = ((membersRaw ?? []) as unknown as MemberRow[])
    .map((m) => m.user)
    .filter((u): u is NonNullable<MemberRow['user']> => u !== null)

  // Últimos 50 mensajes (cronológico ascendente)
  type MessageRow = {
    id: string
    conversation_id: string
    user_id: string | null
    body: string
    edited_at: string | null
    deleted_at: string | null
    created_at: string
    author: { id: string; full_name: string; avatar_url: string | null } | null
  }
  const { data: msgsRaw } = await supabase
    .from('messages')
    .select('id, conversation_id, user_id, body, edited_at, deleted_at, created_at, author:users!messages_user_id_fkey(id, full_name, avatar_url)')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50)
  const msgsAsc = ((msgsRaw ?? []) as unknown as MessageRow[]).reverse()

  const msgIds = msgsAsc.map((m) => m.id)
  const { data: attsRaw } = msgIds.length > 0
    ? await supabase
        .from('message_attachments')
        .select('*')
        .in('message_id', msgIds)
    : { data: [] as MessageAttachment[] }
  const atts = (attsRaw ?? []) as MessageAttachment[]
  const attByMsg = new Map<string, MessageAttachment[]>()
  for (const a of atts) {
    const list = attByMsg.get(a.message_id) ?? []
    list.push(a)
    attByMsg.set(a.message_id, list)
  }

  const initialMessages: MessageWithMeta[] = msgsAsc.map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    user_id: m.user_id,
    body: m.body,
    edited_at: m.edited_at,
    deleted_at: m.deleted_at,
    created_at: m.created_at,
    author: m.author,
    attachments: attByMsg.get(m.id) ?? [],
  }))

  // Para el panel de detalles del canal: adjuntos compartidos en el canal (solo canales)
  let channelAttachments: MessageAttachment[] = []
  if (conversation.type === 'channel') {
    const { data: allMsgsRaw } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
    const allMsgIds = ((allMsgsRaw ?? []) as Array<{ id: string }>).map((x) => x.id)
    if (allMsgIds.length > 0) {
      const { data: allAttsRaw } = await supabase
        .from('message_attachments')
        .select('*')
        .in('message_id', allMsgIds)
        .order('created_at', { ascending: false })
        .limit(50)
      channelAttachments = (allAttsRaw ?? []) as MessageAttachment[]
    }
  }

  // Lista de todos los usuarios (para "Agregar miembros" en canales)
  let allUsers: Pick<AppUser, 'id' | 'full_name' | 'avatar_url' | 'role'>[] = []
  if (conversation.type === 'channel' && isAdmin) {
    const { data: allUsersRaw } = await supabase
      .from('users')
      .select('id, full_name, avatar_url, role')
      .order('full_name', { ascending: true })
    allUsers = (allUsersRaw ?? []) as Pick<AppUser, 'id' | 'full_name' | 'avatar_url' | 'role'>[]
  }

  return (
    <ConversationView
      conversation={conversation}
      members={members}
      allUsers={allUsers}
      initialMessages={initialMessages}
      channelAttachments={channelAttachments}
      currentUserId={user.id}
      isAdmin={isAdmin}
    />
  )
}
