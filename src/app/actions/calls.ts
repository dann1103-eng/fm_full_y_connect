'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { roomNameForConversation } from '@/lib/livekit/rooms'
import { FORCE_CHANNEL_MEMBER_IDS } from '@/lib/domain/team'
import { assertNotImpersonating } from './impersonation'
import { recordMissedCall } from './missedCalls'
import type { CallModality } from '@/types/db'

async function getCurrentUser() {
  await assertNotImpersonating()
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
  const { data: appUser } = await supabase
    .from('users')
    .select('id, role, full_name, avatar_url')
    .eq('id', user.id)
    .single()
  if (!appUser) throw new Error('Usuario no encontrado')
  return { supabase, user: appUser }
}

/**
 * Inicia (o reusa) una llamada en una conversación.
 * - Si ya hay una sesión activa para la conversación, la devuelve.
 * - Si no, crea una nueva.
 * - Notifica por broadcast a los miembros del DM (canales no notifican —
 *   ahí es presence quien indica quién está dentro).
 */
export async function startCall(payload: {
  conversationId: string
  modality: CallModality
}) {
  try {
    const { supabase, user } = await getCurrentUser()
    const { conversationId, modality } = payload

    // Verifica que el user es miembro
    const { data: membership } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('conversation_id', conversationId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) return { error: 'No eres miembro de esta conversación.' }

    // ¿Ya hay sesión activa?
    const { data: existing } = await supabase
      .from('call_sessions')
      .select('id, livekit_room_name, modality')
      .eq('conversation_id', conversationId)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      return {
        sessionId: existing.id,
        roomName: existing.livekit_room_name,
        reused: true as const,
      }
    }

    // Crea una nueva sesión
    const roomName = roomNameForConversation(conversationId)
    const { data: created, error: createErr } = await supabase
      .from('call_sessions')
      .insert({
        conversation_id: conversationId,
        started_by: user.id,
        livekit_room_name: roomName,
        modality,
      })
      .select('id')
      .single()

    if (createErr || !created) {
      return { error: createErr?.message ?? 'No se pudo iniciar la llamada' }
    }

    return {
      sessionId: created.id,
      roomName,
      reused: false as const,
    }
  } catch (e) {
    console.error('startCall failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

/**
 * Notifica a los miembros de una conversación que hay una llamada entrante.
 * - DM: notifica al otro usuario.
 * - channel / voice_channel: notifica a todos los miembros excepto el que inició.
 */
export async function notifyIncomingCall(payload: {
  conversationId: string
  sessionId: string
  modality: CallModality
}) {
  try {
    const { supabase, user } = await getCurrentUser()
    const { conversationId, sessionId, modality } = payload

    const { data: conv } = await supabase
      .from('conversations')
      .select('id, type, name')
      .eq('id', conversationId)
      .single()

    if (!conv) return { ok: true }

    const isChannel = conv.type === 'channel' || conv.type === 'voice_channel'

    const { data: members } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId)

    const targetIds = (members ?? [])
      .map((m: { user_id: string }) => m.user_id)
      .filter((id: string) => id !== user.id)

    if (targetIds.length === 0) return { ok: true }

    const roomName = roomNameForConversation(conversationId)
    const payloadOut = {
      sessionId,
      conversationId,
      roomName,
      modality,
      channelName: isChannel ? (conv.name ?? null) : null,
      fromUser: {
        id: user.id,
        full_name: user.full_name,
        avatar_url: user.avatar_url,
      },
    }

    await Promise.all(
      targetIds.map(async (targetId: string) => {
        const channel = supabase.channel(`user:${targetId}`)
        try {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(
              () => reject(new Error(`subscribe timeout user:${targetId}`)),
              5000,
            )
            channel.subscribe((status) => {
              if (status === 'SUBSCRIBED') {
                clearTimeout(timeout)
                resolve()
              } else if (
                status === 'CHANNEL_ERROR' ||
                status === 'TIMED_OUT' ||
                status === 'CLOSED'
              ) {
                clearTimeout(timeout)
                reject(new Error(`subscribe ${status} user:${targetId}`))
              }
            })
          })
          await channel.send({
            type: 'broadcast',
            event: 'incoming_call',
            payload: payloadOut,
          })
        } catch (err) {
          console.error('[notifyIncomingCall] target failed:', targetId, err)
        } finally {
          await supabase.removeChannel(channel)
        }
      }),
    )

    return { ok: true }
  } catch (e) {
    console.error('notifyIncomingCall failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

/**
 * Marca que el usuario actual salió de la sesión (left_at) sin cerrarla para
 * los demás. Usar en onDisconnected / F5 / cierre de pestaña.
 * El webhook de LiveKit cierra la sesión (ended_at) cuando todos se van.
 */
export async function leaveCall(sessionId: string) {
  try {
    const { supabase, user } = await getCurrentUser()
    const nowIso = new Date().toISOString()

    await supabase
      .from('call_participants')
      .update({ left_at: nowIso })
      .eq('session_id', sessionId)
      .eq('user_id', user.id)
      .is('left_at', null)

    return { ok: true }
  } catch (e) {
    console.error('leaveCall failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

/**
 * Termina la llamada para todos (opcional — el webhook de LiveKit también la cierra
 * cuando todos se van). Útil para "colgar y cerrar para todos" en DMs 1:1.
 */
export async function endCall(sessionId: string) {
  try {
    const { supabase, user } = await getCurrentUser()
    const nowIso = new Date().toISOString()

    const { data: session } = await supabase
      .from('call_sessions')
      .select('id, conversation_id, ended_at')
      .eq('id', sessionId)
      .maybeSingle()

    if (!session) return { error: 'Sesión no encontrada o sin acceso.' }
    if (session.ended_at) return { ok: true }

    const { error: updErr } = await supabase
      .from('call_sessions')
      .update({ ended_at: nowIso })
      .eq('id', sessionId)
    if (updErr) return { error: updErr.message }

    // Marca al usuario actual como left
    await supabase
      .from('call_participants')
      .update({ left_at: nowIso })
      .eq('session_id', sessionId)
      .eq('user_id', user.id)
      .is('left_at', null)

    // Broadcast `call_ended` a todos los demás miembros del conversation. Esto
    // funciona como segunda vía de aviso por si el postgres_changes UPDATE no
    // llega a tiempo (RLS, lag de replica, etc.) — el receptor también está
    // suscrito a `user:{id}` en ActiveCallContext y ahí desconecta.
    try {
      const admin = createAdminClient()
      const { data: members } = await admin
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', session.conversation_id)
      const otherIds = (members ?? [])
        .map((m) => m.user_id as string)
        .filter((id) => id !== user.id)
      await Promise.all(
        otherIds.map((uid) =>
          supabase
            .channel(`user:${uid}`)
            .send({
              type: 'broadcast',
              event: 'call_ended',
              payload: { sessionId },
            })
            .catch(() => {}),
        ),
      )
    } catch (broadcastErr) {
      console.error('endCall broadcast failed (no crítico):', broadcastErr)
    }

    // Si la llamada terminó sin que el receptor la contestara, deja un mensaje
    // de sistema en el chat (DM only). Ejecuta best-effort, no bloquea.
    void recordMissedCall(sessionId)

    return { ok: true }
  } catch (e) {
    console.error('endCall failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

/**
 * Registra (idempotente) que el usuario actual se unió a una sesión.
 * Usar al conectar al room desde el cliente.
 */
export async function recordCallJoin(sessionId: string) {
  try {
    const { supabase, user } = await getCurrentUser()

    const { data: existing } = await supabase
      .from('call_participants')
      .select('session_id')
      .eq('session_id', sessionId)
      .eq('user_id', user.id)
      .is('left_at', null)
      .maybeSingle()

    if (existing) return { ok: true }

    const { error: insErr } = await supabase
      .from('call_participants')
      .insert({ session_id: sessionId, user_id: user.id })
    if (insErr) return { error: insErr.message }

    return { ok: true }
  } catch (e) {
    console.error('recordCallJoin failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

/**
 * Crea un canal de voz persistente. Solo admin/supervisor.
 * Análogo a createChannel pero con type='voice_channel'.
 */
export async function createVoiceChannel(payload: {
  name: string
  description?: string
  memberIds: string[]
}) {
  try {
    const { user } = await getCurrentUser()
    const supabase = await createClient()

    const { data: me } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (me?.role !== 'admin' && me?.role !== 'supervisor') {
      return { error: 'Sin permisos (admin o supervisor requerido).' }
    }

    const name = payload.name.trim().toLowerCase().replace(/\s+/g, '-')
    if (!name) return { error: 'El nombre del canal es obligatorio.' }
    if (!/^[a-z0-9-]+$/.test(name)) {
      return { error: 'El nombre solo puede contener letras, números y guiones.' }
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { error: 'Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno.' }
    }
    const admin = createAdminClient()

    const { data: created, error: createErr } = await admin
      .from('conversations')
      .insert({
        type: 'voice_channel',
        name,
        description: payload.description?.trim() || null,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (createErr || !created) {
      if (createErr?.code === '23505') {
        return { error: 'Ya existe un canal con ese nombre.' }
      }
      return { error: createErr?.message ?? 'No se pudo crear el canal de voz' }
    }

    const memberIds = Array.from(
      new Set([user.id, ...payload.memberIds, ...FORCE_CHANNEL_MEMBER_IDS])
    )
    const { error: memberErr } = await admin
      .from('conversation_members')
      .insert(memberIds.map((uid) => ({ conversation_id: created.id, user_id: uid })))

    if (memberErr) return { error: memberErr.message }

    revalidatePath('/inbox')
    return { conversationId: created.id }
  } catch (e) {
    console.error('createVoiceChannel failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}
