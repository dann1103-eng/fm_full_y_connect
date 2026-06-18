import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/db'

/**
 * UUID fijo del usuario "FM Bot" creado en la migración 0082.
 * Cualquier mensaje, asset o log generado por el sistema de agentes de IA
 * se atribuye a este user_id. No tiene fila en auth.users — nunca se autentica.
 */
export const FM_BOT_USER_ID = '00000000-0000-0000-0000-000000000b07'

/**
 * Inserta un mensaje en requirement_messages atribuido a FM Bot.
 * Requiere admin client (service role) — RLS de requirement_messages
 * exige que user_id = auth.uid() para usuarios normales.
 */
export async function botPostMessage(
  admin: SupabaseClient<Database>,
  args: {
    requirementId: string
    body: string
    visibleToClient?: boolean
    attachmentPath?: string | null
    attachmentType?: string | null
    attachmentName?: string | null
  },
): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('requirement_messages')
    .insert({
      requirement_id: args.requirementId,
      user_id: FM_BOT_USER_ID,
      body: args.body,
      visible_to_client: args.visibleToClient ?? false,
      attachment_path: args.attachmentPath ?? null,
      attachment_type: args.attachmentType ?? null,
      attachment_name: args.attachmentName ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'No se pudo postear el mensaje del bot' }
  }
  return { ok: true, messageId: data.id }
}

/**
 * Stub. La implementación real (subir archivo a review-files, crear review_asset
 * + review_version + review_version_files) se entrega en el sub-proyecto #4
 * (agente productor). El contrato queda fijo aquí para que los handlers
 * que vienen después no dependan del storage layout directamente.
 */
export interface BotReviewVersionArgs {
  requirementId: string
  assetName: string
  files: Array<{ buffer: Uint8Array; mimeType: string; fileName: string }>
}

export async function botCreateReviewVersion(
  admin: SupabaseClient<Database>,
  args: BotReviewVersionArgs,
): Promise<{ ok: false; error: string }> {
  void admin
  void args
  return { ok: false, error: 'botCreateReviewVersion no implementado todavía (sub-proyecto #4)' }
}
