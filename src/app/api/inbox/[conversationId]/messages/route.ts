import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { MessageWithMeta, MessageAttachment } from '@/types/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type MessageRow = {
  id: string
  conversation_id: string
  user_id: string | null
  body: string
  edited_at: string | null
  deleted_at: string | null
  created_at: string
  author: {
    id: string
    full_name: string
    avatar_url: string | null
  } | null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params
  const since = req.nextUrl.searchParams.get('since')
  const limitParam = req.nextUrl.searchParams.get('limit')
  const limit = Math.min(Math.max(parseInt(limitParam ?? '50', 10) || 50, 1), 200)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let query = supabase
    .from('messages')
    .select('id, conversation_id, user_id, body, edited_at, deleted_at, created_at, author:users!messages_user_id_fkey(id, full_name, avatar_url)')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (since) {
    query = query.gt('created_at', since)
  } else {
    query = query.limit(limit)
  }

  const { data: msgsRaw, error: msgsErr } = await query
  if (msgsErr) return NextResponse.json({ error: msgsErr.message }, { status: 500 })
  const msgs = (msgsRaw ?? []) as unknown as MessageRow[]

  if (msgs.length === 0) return NextResponse.json([] as MessageWithMeta[])

  const msgIds = msgs.map((m) => m.id)
  const { data: attsRaw } = await supabase
    .from('message_attachments')
    .select('*')
    .in('message_id', msgIds)

  const attachments = (attsRaw ?? []) as MessageAttachment[]
  const attByMsg = new Map<string, MessageAttachment[]>()
  for (const a of attachments) {
    const list = attByMsg.get(a.message_id) ?? []
    list.push(a)
    attByMsg.set(a.message_id, list)
  }

  const result: MessageWithMeta[] = msgs.map((m) => ({
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

  return NextResponse.json(result)
}
