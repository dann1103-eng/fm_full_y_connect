'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function getCurrentUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')
  return { supabase, userId: user.id }
}

interface SendRequirementMessagePayload {
  requirementId: string
  body: string
  attachmentPath?: string | null
  attachmentType?: string | null
  attachmentName?: string | null
  /** IDs de usuarios mencionados con @ en el body (resueltos en el cliente vía MentionAutocomplete). */
  mentionedUserIds?: string[]
}

/**
 * Envía un mensaje al chat de un requerimiento y registra menciones.
 * Las filas en requirement_mentions se insertan con admin client porque RLS
 * no permite INSERT directo a usuarios comunes.
 */
export async function sendRequirementMessage(payload: SendRequirementMessagePayload) {
  try {
    const { supabase, userId } = await getCurrentUser()

    const body = payload.body.trim()
    if (!body && !payload.attachmentPath) {
      return { error: 'El mensaje no puede estar vacío.' }
    }

    const { data: insertedRaw, error } = await supabase
      .from('requirement_messages')
      .insert({
        requirement_id: payload.requirementId,
        user_id: userId,
        body,
        attachment_path: payload.attachmentPath ?? null,
        attachment_type: payload.attachmentType ?? null,
        attachment_name: payload.attachmentName ?? null,
      })
      .select('id, body, created_at, user_id, attachment_path, attachment_type, attachment_name, user:users(full_name, role, avatar_url)')
      .single()

    const inserted = insertedRaw as {
      id: string
      body: string
      created_at: string
      user_id: string
      attachment_path: string | null
      attachment_type: string | null
      attachment_name: string | null
      user: { full_name: string; role: string; avatar_url: string | null } | null
    } | null

    if (error || !inserted) {
      return { error: error?.message ?? 'No se pudo enviar el mensaje' }
    }

    const mentionIds = Array.from(new Set(payload.mentionedUserIds ?? [])).filter(
      (uid) => uid && uid !== userId,
    )

    if (mentionIds.length > 0 && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const admin = createAdminClient()
      const rows = mentionIds.map((uid) => ({
        message_id: inserted.id,
        requirement_id: payload.requirementId,
        mentioned_user_id: uid,
        mentioned_by_user_id: userId,
      }))
      const { error: menErr } = await admin
        .from('requirement_mentions')
        .upsert(rows, { onConflict: 'message_id,mentioned_user_id' })
      if (menErr) {
        console.error('sendRequirementMessage mentions insert failed:', menErr)
      }
    }

    return { message: inserted }
  } catch (e) {
    console.error('sendRequirementMessage failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

export async function markMentionRead(mentionId: string) {
  try {
    const { supabase, userId } = await getCurrentUser()
    const { error } = await supabase
      .from('requirement_mentions')
      .update({ read_at: new Date().toISOString() })
      .eq('id', mentionId)
      .eq('mentioned_user_id', userId)
    if (error) return { error: error.message }
    return { success: true }
  } catch (e) {
    console.error('markMentionRead failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}

export async function markAllMentionsRead() {
  try {
    const { supabase, userId } = await getCurrentUser()
    const { error } = await supabase
      .from('requirement_mentions')
      .update({ read_at: new Date().toISOString() })
      .eq('mentioned_user_id', userId)
      .is('read_at', null)
    if (error) return { error: error.message }
    return { success: true }
  } catch (e) {
    console.error('markAllMentionsRead failed:', e)
    return { error: e instanceof Error ? e.message : 'Error desconocido' }
  }
}
