'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function getCurrentUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
  const { data: appUser } = await supabase
    .from('users')
    .select('id, role')
    .eq('id', user.id)
    .single()
  if (!appUser) throw new Error('Usuario no encontrado')
  return { supabase, userId: appUser.id, role: appUser.role }
}

async function assertAdmin() {
  const ctx = await getCurrentUser()
  if (ctx.role !== 'admin') throw new Error('Sin permisos de admin')
  return ctx
}

async function assertAdminOrSupervisor() {
  const ctx = await getCurrentUser()
  if (ctx.role !== 'admin' && ctx.role !== 'supervisor') {
    throw new Error('Sin permisos (admin o supervisor requerido)')
  }
  return ctx
}

/* ─────────────────────────────────────────────────────────────────
 * createOrGetDM — idempotente
 * Busca un DM existente entre currentUser y otherUserId; si no, lo crea
 * y agrega ambos miembros con admin client (RLS no permite auto-insert).
 * ───────────────────────────────────────────────────────────────── */
export async function createOrGetDM(otherUserId: string) {
  try {
    const { userId } = await getCurrentUser()
    if (otherUserId === userId) return { error: 'No puedes iniciar un DM contigo mismo.' }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { error: 'Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno.' }
    }
    const admin = createAdminClient()

    // Busca DM existente donde ambos sean miembros
    const { data: existing } = await admin
      .from('conversations')
      .select('id, conversation_members!inner(user_id)')
      .eq('type', 'dm')

    const match = (existing ?? []).find((c) => {
      const members = (c.conversation_members as unknown as { user_id: string }[]) ?? []
      const ids = new Set(members.map((m) => m.user_id))
      return ids.has(userId) && ids.has(otherUserId) && ids.size === 2
    })

    if (match) {
      return { conversationId: match.id }
    }

    const { data: created, error: createErr } = await admin
      .from('conversations')
      .insert({ type: 'dm', created_by: userId })
      .select('id')
      .single()

    if (createErr || !created) return { error: createErr?.message ?? 'No se pudo crear la conversación' }

    const { error: memberErr } = await admin
      .from('conversation_members')
      .insert([
        { conversation_id: created.id, user_id: userId },
        { conversation_id: created.id, user_id: otherUserId },
      ])

    if (memberErr) return { error: memberErr.message }

    revalidatePath('/inbox')
    return { conversationId: created.id }
  } catch (e) {
    console.error('createOrGetDM failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

/* ─────────────────────────────────────────────────────────────────
 * createChannel — solo admin
 * ───────────────────────────────────────────────────────────────── */
export async function createChannel(payload: {
  name: string
  description?: string
  topic?: string
  memberIds: string[]
}) {
  try {
    const { userId } = await assertAdminOrSupervisor()

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
        type: 'channel',
        name,
        description: payload.description?.trim() || null,
        topic: payload.topic?.trim() || null,
        created_by: userId,
      })
      .select('id')
      .single()

    if (createErr || !created) {
      if (createErr?.code === '23505') return { error: 'Ya existe un canal con ese nombre.' }
      return { error: createErr?.message ?? 'No se pudo crear el canal' }
    }

    const memberIds = Array.from(new Set([userId, ...payload.memberIds]))
    const { error: memberErr } = await admin
      .from('conversation_members')
      .insert(memberIds.map((uid) => ({ conversation_id: created.id, user_id: uid })))

    if (memberErr) return { error: memberErr.message }

    revalidatePath('/inbox')
    return { conversationId: created.id }
  } catch (e) {
    console.error('createChannel failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

/* ─────────────────────────────────────────────────────────────────
 * sendMessage
 * Los archivos ya se subieron al bucket desde el cliente; se pasan los
 * storage paths para crear las filas en message_attachments.
 * ───────────────────────────────────────────────────────────────── */
export async function sendMessage(payload: {
  conversationId: string
  body: string
  attachments?: Array<{
    storage_path: string
    file_name: string
    file_size?: number
    mime_type?: string
  }>
}) {
  try {
    const { supabase, userId } = await getCurrentUser()

    const body = payload.body.trim()
    const attachments = payload.attachments ?? []
    if (!body && attachments.length === 0) {
      return { error: 'El mensaje no puede estar vacío.' }
    }

    const { data: msg, error: msgErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: payload.conversationId,
        user_id: userId,
        body,
      })
      .select('id')
      .single()

    if (msgErr || !msg) return { error: msgErr?.message ?? 'No se pudo enviar el mensaje' }

    if (attachments.length > 0) {
      const { error: attErr } = await supabase
        .from('message_attachments')
        .insert(
          attachments.map((a) => ({
            message_id: msg.id,
            storage_path: a.storage_path,
            file_name: a.file_name,
            file_size: a.file_size ?? null,
            mime_type: a.mime_type ?? null,
          }))
        )
      if (attErr) return { error: attErr.message }
    }

    revalidatePath(`/inbox/${payload.conversationId}`)
    revalidatePath('/inbox')
    return { messageId: msg.id }
  } catch (e) {
    console.error('sendMessage failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

export async function editMessage(payload: { messageId: string; body: string }) {
  try {
    const { supabase } = await getCurrentUser()
    const body = payload.body.trim()
    if (!body) return { error: 'El mensaje no puede estar vacío.' }

    const { data, error } = await supabase
      .from('messages')
      .update({ body, edited_at: new Date().toISOString() })
      .eq('id', payload.messageId)
      .select('conversation_id')
      .single()

    if (error) return { error: error.message }

    if (data?.conversation_id) {
      revalidatePath(`/inbox/${data.conversation_id}`)
    }
    return { success: true }
  } catch (e) {
    console.error('editMessage failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

export async function deleteMessage(messageId: string) {
  try {
    const { supabase } = await getCurrentUser()

    // Fetch conversation_id first (before soft-delete hides the row from SELECT).
    const { data: msg, error: fetchError } = await supabase
      .from('messages')
      .select('conversation_id')
      .eq('id', messageId)
      .single()

    if (fetchError) return { error: fetchError.message }

    const { error } = await supabase
      .from('messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', messageId)

    if (error) return { error: error.message }

    if (msg?.conversation_id) {
      revalidatePath(`/inbox/${msg.conversation_id}`)
    }
    return { success: true }
  } catch (e) {
    console.error('deleteMessage failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

export async function markConversationRead(conversationId: string) {
  try {
    const { supabase, userId } = await getCurrentUser()

    const { error } = await supabase
      .from('conversation_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)

    if (error) return { error: error.message }
    return { success: true }
  } catch (e) {
    console.error('markConversationRead failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

export async function markAllConversationsRead() {
  try {
    const { supabase, userId } = await getCurrentUser()
    const { error } = await supabase
      .from('conversation_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('user_id', userId)
    if (error) return { error: error.message }
    return { success: true }
  } catch (e) {
    console.error('markAllConversationsRead failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

export async function leaveChannel(conversationId: string) {
  try {
    const { supabase, userId } = await getCurrentUser()

    const { error } = await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)

    if (error) return { error: error.message }

    revalidatePath('/inbox')
    return { success: true }
  } catch (e) {
    console.error('leaveChannel failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

export async function addChannelMembers(conversationId: string, userIds: string[]) {
  try {
    await assertAdminOrSupervisor()

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { error: 'Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno.' }
    }
    const admin = createAdminClient()

    const { data: conv } = await admin
      .from('conversations')
      .select('type')
      .eq('id', conversationId)
      .single()
    if (!conv || conv.type !== 'channel') return { error: 'Solo aplica a canales.' }

    const rows = userIds.map((uid) => ({ conversation_id: conversationId, user_id: uid }))
    const { error } = await admin
      .from('conversation_members')
      .upsert(rows, { onConflict: 'conversation_id,user_id' })

    if (error) return { error: error.message }

    revalidatePath(`/inbox/${conversationId}`)
    return { success: true }
  } catch (e) {
    console.error('addChannelMembers failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

export async function removeChannelMember(conversationId: string, targetUserId: string) {
  try {
    const { userId } = await assertAdminOrSupervisor()
    if (targetUserId === userId) {
      return { error: 'Usa "Salir del canal" para removerte a ti mismo.' }
    }

    const supabase = await createClient()
    const { data: conv } = await supabase
      .from('conversations')
      .select('type')
      .eq('id', conversationId)
      .single()
    if (!conv || conv.type !== 'channel') return { error: 'Solo aplica a canales.' }

    const { error } = await supabase
      .from('conversation_members')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('user_id', targetUserId)

    if (error) return { error: error.message }

    revalidatePath(`/inbox/${conversationId}`)
    return { success: true }
  } catch (e) {
    console.error('removeChannelMember failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

/* ─────────────────────────────────────────────────────────────────
 * deleteChannel — solo admin. Borra canal + cascada en BD y archivos en bucket.
 * ───────────────────────────────────────────────────────────────── */
export async function deleteChannel(conversationId: string) {
  try {
    await assertAdminOrSupervisor()

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { error: 'Falta SUPABASE_SERVICE_ROLE_KEY en variables de entorno.' }
    }
    const admin = createAdminClient()

    const { data: conv } = await admin
      .from('conversations')
      .select('type')
      .eq('id', conversationId)
      .single()
    if (!conv || conv.type !== 'channel') return { error: 'Solo los canales se pueden eliminar.' }

    // Limpieza de archivos del bucket bajo el prefijo del canal
    const { data: files } = await admin.storage
      .from('chat-attachments')
      .list(conversationId, { limit: 1000, offset: 0 })

    if (files && files.length > 0) {
      const paths: string[] = []
      for (const entry of files) {
        const { data: inner } = await admin.storage
          .from('chat-attachments')
          .list(`${conversationId}/${entry.name}`, { limit: 1000 })
        for (const f of inner ?? []) {
          paths.push(`${conversationId}/${entry.name}/${f.name}`)
        }
      }
      if (paths.length > 0) {
        await admin.storage.from('chat-attachments').remove(paths)
      }
    }

    const { error } = await admin
      .from('conversations')
      .delete()
      .eq('id', conversationId)

    if (error) return { error: error.message }

    revalidatePath('/inbox')
    return { success: true }
  } catch (e) {
    console.error('deleteChannel failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

export async function deleteAttachment(attachmentId: string) {
  try {
    const { supabase } = await getCurrentUser()

    const { data: att } = await supabase
      .from('message_attachments')
      .select('id, storage_path, message_id, messages(conversation_id)')
      .eq('id', attachmentId)
      .single()

    if (!att) return { error: 'Adjunto no encontrado.' }

    const { error: delRowErr } = await supabase
      .from('message_attachments')
      .delete()
      .eq('id', attachmentId)

    if (delRowErr) return { error: delRowErr.message }

    // Limpiar objeto del bucket con admin (la política del bucket puede restringir)
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const admin = createAdminClient()
      await admin.storage.from('chat-attachments').remove([att.storage_path])
    }

    const convId = (att.messages as unknown as { conversation_id: string } | null)?.conversation_id
    if (convId) revalidatePath(`/inbox/${convId}`)
    return { success: true }
  } catch (e) {
    console.error('deleteAttachment failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

/* ─────────────────────────────────────────────────────────────────
 * shareRequirementToConversation — envía un mensaje con un marcador
 * especial <<<req-share:{id}:{title}>>> que el cliente renderiza como card.
 * ───────────────────────────────────────────────────────────────── */
export async function shareRequirementToConversation(payload: {
  conversationId: string
  requirementId: string
  requirementTitle: string
}) {
  try {
    const { supabase, userId } = await getCurrentUser()

    const safeTitle = payload.requirementTitle.replace(/[\r\n<>]/g, ' ').trim() || 'Sin título'
    const body = `<<<req-share:${payload.requirementId}:${safeTitle}>>>`

    const { data: msg, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: payload.conversationId,
        user_id: userId,
        body,
      })
      .select('id')
      .single()

    if (error || !msg) return { error: error?.message ?? 'No se pudo compartir el requerimiento' }

    revalidatePath(`/inbox/${payload.conversationId}`)
    revalidatePath('/inbox')
    return { messageId: msg.id }
  } catch (e) {
    console.error('shareRequirementToConversation failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

export async function updateChannelMeta(payload: {
  conversationId: string
  name?: string
  description?: string | null
  topic?: string | null
}) {
  try {
    await assertAdminOrSupervisor()

    const update: {
      name?: string
      description?: string | null
      topic?: string | null
    } = {}
    if (payload.name !== undefined) {
      const name = payload.name.trim().toLowerCase().replace(/\s+/g, '-')
      if (!/^[a-z0-9-]+$/.test(name)) {
        return { error: 'El nombre solo puede contener letras, números y guiones.' }
      }
      update.name = name
    }
    if (payload.description !== undefined) update.description = payload.description?.trim() || null
    if (payload.topic !== undefined) update.topic = payload.topic?.trim() || null

    const supabase = await createClient()
    const { error } = await supabase
      .from('conversations')
      .update(update)
      .eq('id', payload.conversationId)

    if (error) return { error: error.message }

    revalidatePath(`/inbox/${payload.conversationId}`)
    revalidatePath('/inbox')
    return { success: true }
  } catch (e) {
    console.error('updateChannelMeta failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}
