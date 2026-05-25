'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { requireUser } from '@/lib/auth/require-user'

/**
 * Si la sesión `sessionId` corresponde a un DM cerrado sin que el receptor
 * haya entrado, registra un mensaje de sistema `system_missed_call` en la
 * conversación. No-op para canales y para llamadas que sí fueron contestadas.
 *
 * Server-only (admin client). Falla silenciosamente — no es crítico.
 */
export async function recordMissedCall(sessionId: string): Promise<void> {
  try {
    await requireUser()
    const admin = createAdminClient()
    const { data: session } = await admin
      .from('call_sessions')
      .select('id, conversation_id, started_by, ended_at, conversations:conversations!inner(type)')
      .eq('id', sessionId)
      .maybeSingle<{
        id: string
        conversation_id: string
        started_by: string
        ended_at: string | null
        conversations: { type: 'dm' | 'channel' | 'voice_channel' }
          | { type: 'dm' | 'channel' | 'voice_channel' }[]
      }>()
    if (!session || !session.ended_at) return

    const convType = Array.isArray(session.conversations)
      ? session.conversations[0]?.type
      : session.conversations?.type
    if (convType !== 'dm') return

    // ¿algún participante distinto al iniciador entró a la sala?
    const { data: parts } = await admin
      .from('call_participants')
      .select('user_id, joined_at')
      .eq('session_id', sessionId)
      .not('joined_at', 'is', null)
    const someoneAnswered = (parts ?? []).some((p) => p.user_id !== session.started_by)
    if (someoneAnswered) return

    // Evita duplicar si ya hay un system_missed_call para esta sesión
    const { data: existing } = await admin
      .from('messages')
      .select('id')
      .eq('conversation_id', session.conversation_id)
      .eq('kind', 'system_missed_call')
      .eq('user_id', session.started_by)
      // Evita atrapar mensajes muy antiguos: solo en los últimos 5 min
      .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle()
    if (existing) return

    await admin.from('messages').insert({
      conversation_id: session.conversation_id,
      user_id: session.started_by,
      body: '', // body es NOT NULL DEFAULT ''; el render usa `kind` para diferenciar
      kind: 'system_missed_call',
    })
  } catch (err) {
    console.error('[recordMissedCall]', err)
  }
}
