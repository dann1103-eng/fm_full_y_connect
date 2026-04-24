import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { NotificationItem } from '@/types/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type MentionRow = {
  id: string
  message_id: string
  requirement_id: string
  mentioned_by_user_id: string | null
  read_at: string | null
  created_at: string
  message: { body: string } | null
  requirement: {
    title: string
    billing_cycle: { client: { id: string } | null } | null
  } | null
  mentioned_by: { id: string; full_name: string; avatar_url: string | null } | null
}

type ReviewMentionRow = {
  id: string
  comment_id: string
  requirement_id: string
  mentioned_by_user_id: string | null
  read_at: string | null
  created_at: string
  comment: {
    body: string
    pin: {
      id: string
      version: {
        id: string
        asset: { name: string } | null
      } | null
    } | null
  } | null
  requirement: {
    title: string
    billing_cycle: { client: { id: string } | null } | null
  } | null
  mentioned_by: { id: string; full_name: string; avatar_url: string | null } | null
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
  user: { id: string; full_name: string; avatar_url: string | null } | null
}

type LastMsgRow = {
  conversation_id: string
  body: string
  created_at: string
}

function formatSharePreview(body: string): string {
  if (body.startsWith('<<<req-share:')) {
    const m = body.match(/^<<<req-share:[^:]+:(.+)>>>$/)
    const title = m?.[1]?.trim() || 'requerimiento'
    return `Compartió el requerimiento: ${title}`
  }
  return body
}

type OverdueReqRow = {
  id: string
  title: string
  deadline: string
  billing_cycle: { client: { name: string } | null } | null
}

const TERMINAL_PHASES = ['publicado_entregado']

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  /* ── Role check ────────────────────────────────────────────── */
  const { data: appUser } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  const isAdminOrSupervisor =
    appUser?.role === 'admin' || appUser?.role === 'supervisor'

  /* ── Menciones de chat de requerimiento ───────────────────── */
  const mentionsSince = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString()
  const [mentionsRes, reviewMentionsRes] = await Promise.all([
    supabase
      .from('requirement_mentions')
      .select(`
        id, message_id, requirement_id, mentioned_by_user_id, read_at, created_at,
        message:requirement_messages!requirement_mentions_message_id_fkey(body),
        requirement:requirements!requirement_mentions_requirement_id_fkey(
          title,
          billing_cycle:billing_cycles!requirements_billing_cycle_id_fkey(
            client:clients!billing_cycles_client_id_fkey(id)
          )
        ),
        mentioned_by:users!requirement_mentions_mentioned_by_user_id_fkey(id, full_name, avatar_url)
      `)
      .eq('mentioned_user_id', user.id)
      .or(`read_at.is.null,created_at.gte.${mentionsSince}`)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('review_comment_mentions')
      .select(`
        id, comment_id, requirement_id, mentioned_by_user_id, read_at, created_at,
        comment:review_comments!review_comment_mentions_comment_id_fkey(
          body,
          pin:review_pins!review_comments_pin_id_fkey(
            id,
            version:review_versions!review_pins_version_id_fkey(
              id,
              asset:review_assets!review_versions_asset_id_fkey(name)
            )
          )
        ),
        requirement:requirements!review_comment_mentions_requirement_id_fkey(
          title,
          billing_cycle:billing_cycles!requirements_billing_cycle_id_fkey(
            client:clients!billing_cycles_client_id_fkey(id)
          )
        ),
        mentioned_by:users!review_comment_mentions_mentioned_by_user_id_fkey(id, full_name, avatar_url)
      `)
      .eq('mentioned_user_id', user.id)
      .or(`read_at.is.null,created_at.gte.${mentionsSince}`)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  const mentions = (mentionsRes.data ?? []) as unknown as MentionRow[]
  const reviewMentions = (reviewMentionsRes.data ?? []) as unknown as ReviewMentionRow[]

  const mentionItems: NotificationItem[] = mentions.map((m) => ({
    kind: 'mention',
    id: m.id,
    created_at: m.created_at,
    read: m.read_at !== null,
    requirement_id: m.requirement_id,
    requirement_title: m.requirement?.title ?? 'Requerimiento',
    message_preview: (m.message?.body ?? '').slice(0, 140),
    mention_source: 'requirement',
    client_id: m.requirement?.billing_cycle?.client?.id,
    mentioned_by: m.mentioned_by
      ? {
          id: m.mentioned_by.id,
          full_name: m.mentioned_by.full_name,
          avatar_url: m.mentioned_by.avatar_url,
        }
      : undefined,
  }))

  const reviewMentionItems: NotificationItem[] = reviewMentions.map((m) => ({
    kind: 'mention',
    id: m.id,
    created_at: m.created_at,
    read: m.read_at !== null,
    requirement_id: m.requirement_id,
    requirement_title: m.requirement?.title ?? 'Requerimiento',
    message_preview: (m.comment?.body ?? '').slice(0, 140),
    mention_source: 'review',
    review_pin_id: m.comment?.pin?.id,
    review_version_id: m.comment?.pin?.version?.id,
    review_asset_name: m.comment?.pin?.version?.asset?.name,
    client_id: m.requirement?.billing_cycle?.client?.id,
    mentioned_by: m.mentioned_by
      ? {
          id: m.mentioned_by.id,
          full_name: m.mentioned_by.full_name,
          avatar_url: m.mentioned_by.avatar_url,
        }
      : undefined,
  }))

  /* ── Conversaciones con unread ─────────────────────────────── */
  const { data: convsRaw } = await supabase
    .from('conversations')
    .select('id, type, name, last_message_at')
    .order('last_message_at', { ascending: false })

  const convs = (convsRaw ?? []) as ConvRow[]
  const convItems: NotificationItem[] = []

  if (convs.length > 0) {
    const convIds = convs.map((c) => c.id)

    const { data: myMembersRaw } = await supabase
      .from('conversation_members')
      .select('conversation_id, last_read_at')
      .eq('user_id', user.id)
      .in('conversation_id', convIds)

    const myMembers = (myMembersRaw ?? []) as MemberRow[]
    const lastReadByConv = new Map<string, string>()
    for (const m of myMembers) lastReadByConv.set(m.conversation_id, m.last_read_at)

    const dmIds = convs.filter((c) => c.type === 'dm').map((c) => c.id)
    const counterpartByConv = new Map<string, NotificationItem['counterpart']>()
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

    for (const c of convs) {
      const lastRead = lastReadByConv.get(c.id)
      if (!lastRead) continue
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', c.id)
        .is('deleted_at', null)
        .neq('user_id', user.id)
        .gt('created_at', lastRead)
      const unread = count ?? 0
      if (unread === 0) continue

      convItems.push({
        kind: c.type === 'dm' ? 'dm' : 'channel',
        id: c.id,
        created_at: c.last_message_at,
        read: false,
        conversation_id: c.id,
        conversation_name: c.name,
        conversation_type: c.type,
        counterpart: c.type === 'dm' ? counterpartByConv.get(c.id) ?? null : null,
        unread_count: unread,
        last_message_preview: previewByConv.get(c.id) ?? null,
      })
    }
  }

  /* ── Requerimientos vencidos (solo admin/supervisor) ───────── */
  const overdueItems: NotificationItem[] = []
  if (isAdminOrSupervisor) {
    const today = new Date().toISOString().split('T')[0]
    const { data: overdueRaw } = await supabase
      .from('requirements')
      .select('id, title, deadline, billing_cycle:billing_cycles!requirements_billing_cycle_id_fkey(client:clients!billing_cycles_client_id_fkey(name))')
      .lt('deadline', today)
      .not('phase', 'in', `(${TERMINAL_PHASES.map((p) => `"${p}"`).join(',')})`)
      .eq('voided', false)
      .order('deadline', { ascending: true })
      .limit(99)

    for (const r of (overdueRaw ?? []) as unknown as OverdueReqRow[]) {
      const daysOverdue = Math.floor(
        (new Date().getTime() - new Date(`${r.deadline}T23:59:59`).getTime()) / 86400000,
      )
      overdueItems.push({
        kind: 'overdue',
        id: r.id,
        created_at: `${r.deadline}T23:59:59.000Z`,
        read: false,
        overdue_requirement_id: r.id,
        overdue_requirement_title: r.title || 'Sin título',
        overdue_client_name: r.billing_cycle?.client?.name ?? '',
        overdue_days: daysOverdue,
      })
    }
  }

  /* ── Eventos de calendario (asignaciones recientes + próximos 24h) ── */
  const calendarItems: NotificationItem[] = []
  {
    const now = new Date()
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: eventsRaw } = await supabase
      .from('time_entries')
      .select('id, title, scheduled_at, scheduled_attendees, created_at')
      .eq('category', 'reunion_interna')
      .contains('scheduled_attendees', [user.id])
      .gte('scheduled_at', now.toISOString())
      .lte('scheduled_at', in24h)
      .order('scheduled_at', { ascending: true })
      .limit(50)

    const { data: recentAssignedRaw } = await supabase
      .from('time_entries')
      .select('id, title, scheduled_at, scheduled_attendees, created_at')
      .eq('category', 'reunion_interna')
      .contains('scheduled_attendees', [user.id])
      .gte('created_at', last7d)
      .order('created_at', { ascending: false })
      .limit(50)

    const seen = new Set<string>()
    for (const r of (eventsRaw ?? []) as Array<{ id: string; title: string; scheduled_at: string | null; created_at: string }>) {
      if (!r.scheduled_at) continue
      seen.add(r.id)
      calendarItems.push({
        kind: 'calendar',
        id: `cal-upcoming-${r.id}`,
        created_at: r.scheduled_at,
        read: false,
        calendar_entry_id: r.id,
        calendar_title: r.title,
        calendar_scheduled_at: r.scheduled_at,
        calendar_reason: 'upcoming',
      })
    }
    for (const r of (recentAssignedRaw ?? []) as Array<{ id: string; title: string; scheduled_at: string | null; created_at: string }>) {
      if (seen.has(r.id)) continue
      calendarItems.push({
        kind: 'calendar',
        id: `cal-assigned-${r.id}`,
        created_at: r.created_at,
        read: false,
        calendar_entry_id: r.id,
        calendar_title: r.title,
        calendar_scheduled_at: r.scheduled_at ?? undefined,
        calendar_reason: 'assigned',
      })
    }
  }

  /* ── Facturas auto-emitidas recientes (solo admin) ─────────── */
  const invoiceAutoItems: NotificationItem[] = []
  if (appUser?.role === 'admin') {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: autoInvoices } = await supabase
      .from('invoices')
      .select('id, invoice_number, total, currency, created_at, client:clients!invoices_client_id_fkey(name)')
      .eq('status', 'issued')
      .is('created_by', null)
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(30)

    for (const inv of (autoInvoices ?? []) as Array<{
      id: string
      invoice_number: string
      total: number
      currency: string
      created_at: string
      client: { name: string } | null
    }>) {
      invoiceAutoItems.push({
        kind: 'invoice_auto',
        id: `inv-auto-${inv.id}`,
        created_at: inv.created_at,
        read: false,
        invoice_id: inv.id,
        invoice_number: inv.invoice_number,
        invoice_client_name: inv.client?.name ?? '',
        invoice_total: inv.total,
        invoice_currency: inv.currency,
      })
    }
  }

  /* ── Merge y sort: vencidos al frente, luego por fecha ─────── */
  const items = [...overdueItems, ...mentionItems, ...reviewMentionItems, ...invoiceAutoItems, ...calendarItems, ...convItems].sort((a, b) => {
    if (a.kind === 'overdue' && b.kind !== 'overdue') return -1
    if (a.kind !== 'overdue' && b.kind === 'overdue') return 1
    return a.created_at < b.created_at ? 1 : -1
  })

  return NextResponse.json(items)
}
