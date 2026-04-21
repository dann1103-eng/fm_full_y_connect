import { createClient } from '@/lib/supabase/server'
import { InboxSidebar } from '@/components/inbox/InboxSidebar'
import type { AppUser, ConversationListItem } from '@/types/db'

function formatSharePreview(body: string): string {
  if (body.startsWith('<<<req-share:')) {
    const m = body.match(/^<<<req-share:[^:]+:(.+)>>>$/)
    const title = m?.[1]?.trim() || 'requerimiento'
    return `Compartió el requerimiento: ${title}`
  }
  return body
}

async function loadInitialList(): Promise<ConversationListItem[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: convsRaw } = await supabase
    .from('conversations')
    .select('id, type, name, last_message_at')
    .order('last_message_at', { ascending: false })

  type ConvRow = { id: string; type: 'dm' | 'channel'; name: string | null; last_message_at: string }
  const convs = (convsRaw ?? []) as ConvRow[]
  if (convs.length === 0) return []

  const ids = convs.map((c) => c.id)

  const { data: myMembersRaw } = await supabase
    .from('conversation_members')
    .select('conversation_id, last_read_at')
    .eq('user_id', user.id)
    .in('conversation_id', ids)
  const lastReadByConv = new Map<string, string>()
  for (const m of (myMembersRaw ?? []) as Array<{ conversation_id: string; last_read_at: string }>) {
    lastReadByConv.set(m.conversation_id, m.last_read_at)
  }

  type MemberRow = {
    conversation_id: string
    user_id: string
    user: { id: string; full_name: string; avatar_url: string | null } | null
  }
  const counterpartByConv = new Map<string, ConversationListItem['counterpart']>()
  const dmIds = convs.filter((c) => c.type === 'dm').map((c) => c.id)
  if (dmIds.length > 0) {
    const { data: membersRaw } = await supabase
      .from('conversation_members')
      .select('conversation_id, user_id, user:users!conversation_members_user_id_fkey(id, full_name, avatar_url)')
      .in('conversation_id', dmIds)
    for (const m of (membersRaw ?? []) as unknown as MemberRow[]) {
      if (m.user_id !== user.id && m.user) {
        counterpartByConv.set(m.conversation_id, {
          id: m.user.id,
          full_name: m.user.full_name,
          avatar_url: m.user.avatar_url,
        })
      }
    }
  }

  const { data: lastMsgsRaw } = await supabase
    .from('messages')
    .select('conversation_id, body, created_at')
    .in('conversation_id', ids)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(500)
  const previewByConv = new Map<string, string>()
  for (const m of (lastMsgsRaw ?? []) as Array<{ conversation_id: string; body: string; created_at: string }>) {
    if (!previewByConv.has(m.conversation_id)) previewByConv.set(m.conversation_id, formatSharePreview(m.body))
  }

  const items: ConversationListItem[] = []
  for (const c of convs) {
    const lastRead = lastReadByConv.get(c.id)
    let unread = 0
    if (lastRead) {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', c.id)
        .is('deleted_at', null)
        .neq('user_id', user.id)
        .gt('created_at', lastRead)
      unread = count ?? 0
    }
    items.push({
      id: c.id,
      type: c.type,
      name: c.name,
      last_message_at: c.last_message_at,
      unread_count: unread,
      counterpart: c.type === 'dm' ? counterpartByConv.get(c.id) ?? null : null,
      last_message_preview: previewByConv.get(c.id) ?? null,
    })
  }
  return items
}

async function loadAllUsers(): Promise<Pick<AppUser, 'id' | 'full_name' | 'avatar_url' | 'role'>[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('users')
    .select('id, full_name, avatar_url, role')
    .order('full_name', { ascending: true })
  return (data ?? []) as Pick<AppUser, 'id' | 'full_name' | 'avatar_url' | 'role'>[]
}

export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const [initialList, allUsers] = await Promise.all([loadInitialList(), loadAllUsers()])

  return (
    <div className="flex h-full overflow-hidden">
      <InboxSidebar initialList={initialList} allUsers={allUsers} />
      <div className="flex-1 flex overflow-hidden">{children}</div>
    </div>
  )
}
