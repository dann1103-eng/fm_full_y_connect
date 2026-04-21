import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ConversationListItem } from '@/types/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function formatSharePreview(body: string): string {
  if (body.startsWith('<<<req-share:')) {
    const m = body.match(/^<<<req-share:[^:]+:(.+)>>>$/)
    const title = m?.[1]?.trim() || 'requerimiento'
    return `Compartió el requerimiento: ${title}`
  }
  return body
}

type ConvRow = {
  id: string
  type: 'dm' | 'channel'
  name: string | null
  last_message_at: string
}

type MemberRow = {
  conversation_id: string
  last_read_at: string
}

type MemberWithUser = {
  conversation_id: string
  user_id: string
  user: {
    id: string
    full_name: string
    avatar_url: string | null
  } | null
}

type LastMsgRow = {
  conversation_id: string
  body: string
  created_at: string
}

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Conversaciones visibles vía RLS (is_conversation_member)
  const { data: convsRaw, error: convsErr } = await supabase
    .from('conversations')
    .select('id, type, name, last_message_at')
    .order('last_message_at', { ascending: false })

  if (convsErr) return NextResponse.json({ error: convsErr.message }, { status: 500 })
  const convs = (convsRaw ?? []) as ConvRow[]
  if (convs.length === 0) return NextResponse.json([] as ConversationListItem[])

  const convIds = convs.map((c) => c.id)

  // Mi last_read_at por conversación
  const { data: myMembersRaw } = await supabase
    .from('conversation_members')
    .select('conversation_id, last_read_at')
    .eq('user_id', user.id)
    .in('conversation_id', convIds)

  const myMembers = (myMembersRaw ?? []) as MemberRow[]
  const lastReadByConv = new Map<string, string>()
  for (const m of myMembers) lastReadByConv.set(m.conversation_id, m.last_read_at)

  // Para DMs: traer al otro miembro
  const dmIds = convs.filter((c) => c.type === 'dm').map((c) => c.id)
  const counterpartByConv = new Map<string, ConversationListItem['counterpart']>()
  if (dmIds.length > 0) {
    const { data: membersRaw } = await supabase
      .from('conversation_members')
      .select('conversation_id, user_id, user:users!conversation_members_user_id_fkey(id, full_name, avatar_url)')
      .in('conversation_id', dmIds)

    const members = (membersRaw ?? []) as unknown as MemberWithUser[]
    for (const m of members) {
      if (m.user_id !== user.id && m.user) {
        counterpartByConv.set(m.conversation_id, {
          id: m.user.id,
          full_name: m.user.full_name,
          avatar_url: m.user.avatar_url,
        })
      }
    }
  }

  // Último mensaje visible por conversación (para preview)
  const { data: lastMsgsRaw } = await supabase
    .from('messages')
    .select('conversation_id, body, created_at')
    .in('conversation_id', convIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(500)

  const lastMsgs = (lastMsgsRaw ?? []) as LastMsgRow[]
  const previewByConv = new Map<string, string>()
  for (const m of lastMsgs) {
    if (!previewByConv.has(m.conversation_id)) {
      previewByConv.set(m.conversation_id, formatSharePreview(m.body))
    }
  }

  // unread_count = count messages donde created_at > last_read_at y autor != yo
  const unreadByConv = new Map<string, number>()
  for (const c of convs) {
    const lastRead = lastReadByConv.get(c.id)
    if (!lastRead) {
      unreadByConv.set(c.id, 0)
      continue
    }
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', c.id)
      .is('deleted_at', null)
      .neq('user_id', user.id)
      .gt('created_at', lastRead)
    unreadByConv.set(c.id, count ?? 0)
  }

  const items: ConversationListItem[] = convs.map((c) => ({
    id: c.id,
    type: c.type,
    name: c.name,
    last_message_at: c.last_message_at,
    unread_count: unreadByConv.get(c.id) ?? 0,
    counterpart: c.type === 'dm' ? counterpartByConv.get(c.id) ?? null : null,
    last_message_preview: previewByConv.get(c.id) ?? null,
  }))

  return NextResponse.json(items)
}
