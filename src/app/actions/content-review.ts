'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  ReviewAssetKind,
  ReviewAsset,
  ReviewVersion,
  ReviewVersionFile,
  ReviewPin,
  ReviewComment,
} from '@/types/db'

async function insertReviewMentions(args: {
  commentId: string
  requirementId: string
  mentionedUserIds: string[]
  mentionedByUserId: string
}) {
  const ids = Array.from(new Set(args.mentionedUserIds)).filter(
    (uid) => uid && uid !== args.mentionedByUserId,
  )
  if (ids.length === 0) return
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return
  const admin = createAdminClient()
  const rows = ids.map((uid) => ({
    comment_id: args.commentId,
    requirement_id: args.requirementId,
    mentioned_user_id: uid,
    mentioned_by_user_id: args.mentionedByUserId,
  }))
  const { error } = await admin
    .from('review_comment_mentions')
    .upsert(rows, { onConflict: 'comment_id,mentioned_user_id' })
  if (error) {
    console.error('insertReviewMentions failed:', error)
  }
}

const DOWNLOAD_URL_EXPIRES_SECONDS = 60 * 60 // 1 hora

type ActionResult<T> = { ok: true; data: T } | { error: string }

// ─────────────────────────────────────────────────────────────────────────────
// ASSETS
// ─────────────────────────────────────────────────────────────────────────────

export async function createReviewAsset(args: {
  requirementId: string
  clientId: string
  name: string
  kind: ReviewAssetKind
}): Promise<ActionResult<ReviewAsset>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  const { data, error } = await supabase
    .from('review_assets')
    .insert({
      requirement_id: args.requirementId,
      name: args.name,
      kind: args.kind,
      created_by: user.id,
    })
    .select('*')
    .single()

  if (error || !data) return { error: error?.message ?? 'Error al crear el asset.' }

  revalidatePath(`/clients/${args.clientId}`)
  return { ok: true, data: data as ReviewAsset }
}

export async function archiveReviewAsset(args: {
  assetId: string
  clientId: string
}): Promise<ActionResult<null>> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('review_assets')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', args.assetId)

  if (error) return { error: error.message }
  revalidatePath(`/clients/${args.clientId}`)
  return { ok: true, data: null }
}

// ─────────────────────────────────────────────────────────────────────────────
// VERSIONS
// ─────────────────────────────────────────────────────────────────────────────

export async function createReviewVersion(args: {
  assetId: string
  clientId: string
  storagePath: string
  mimeType: string
  byteSize: number
  durationMs?: number | null
  thumbnailPath?: string | null
}): Promise<ActionResult<ReviewVersion>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  const { data: latest } = await supabase
    .from('review_versions')
    .select('version_number')
    .eq('asset_id', args.assetId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = (latest?.version_number ?? 0) + 1

  const { data, error } = await supabase
    .from('review_versions')
    .insert({
      asset_id: args.assetId,
      version_number: nextVersion,
      storage_path: args.storagePath,
      mime_type: args.mimeType,
      byte_size: args.byteSize,
      duration_ms: args.durationMs ?? null,
      thumbnail_path: args.thumbnailPath ?? null,
      uploaded_by: user.id,
    })
    .select('*')
    .single()

  if (error || !data) return { error: error?.message ?? 'Error al crear la versión.' }

  revalidatePath(`/clients/${args.clientId}`)
  return { ok: true, data: data as ReviewVersion }
}

export interface ReviewVersionFileInput {
  storagePath: string
  mimeType: string
  byteSize: number
  thumbnailPath?: string | null
  durationMs?: number | null
}

/**
 * Crea una versión con N archivos. Valida que no existan pines activos en la
 * versión previa más reciente del mismo asset (gating de aprobación).
 */
export async function createReviewVersionWithFiles(args: {
  assetId: string
  clientId: string
  files: ReviewVersionFileInput[]
}): Promise<ActionResult<{ version: ReviewVersion; files: ReviewVersionFile[] }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }
  if (!args.files || args.files.length === 0) {
    return { error: 'Debes incluir al menos un archivo.' }
  }

  const { data: latest } = await supabase
    .from('review_versions')
    .select('id, version_number')
    .eq('asset_id', args.assetId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Gating: si la última versión tiene pines activos, no permitir subir nueva.
  if (latest?.id) {
    const { count: activePins } = await supabase
      .from('review_pins')
      .select('id', { count: 'exact', head: true })
      .eq('version_id', latest.id)
      .eq('status', 'active')
    if ((activePins ?? 0) > 0) {
      return {
        error:
          'Resuelve los pines activos de la versión anterior antes de subir una nueva versión.',
      }
    }
  }

  const nextVersion = (latest?.version_number ?? 0) + 1
  const primary = args.files[0]

  const { data: version, error: versionErr } = await supabase
    .from('review_versions')
    .insert({
      asset_id: args.assetId,
      version_number: nextVersion,
      storage_path: primary.storagePath,
      mime_type: primary.mimeType,
      byte_size: primary.byteSize,
      duration_ms: primary.durationMs ?? null,
      thumbnail_path: primary.thumbnailPath ?? null,
      uploaded_by: user.id,
    })
    .select('*')
    .single()

  if (versionErr || !version) {
    return { error: versionErr?.message ?? 'Error al crear la versión.' }
  }

  const fileRows = args.files.map((f, idx) => ({
    version_id: version.id,
    file_order: idx,
    storage_path: f.storagePath,
    thumbnail_path: f.thumbnailPath ?? null,
    mime_type: f.mimeType,
    byte_size: f.byteSize,
    duration_ms: f.durationMs ?? null,
  }))

  const { data: files, error: filesErr } = await supabase
    .from('review_version_files')
    .insert(fileRows)
    .select('*')

  if (filesErr || !files) {
    await supabase.from('review_versions').delete().eq('id', version.id)
    return { error: filesErr?.message ?? 'Error al registrar los archivos.' }
  }

  revalidatePath(`/clients/${args.clientId}`)
  return {
    ok: true,
    data: {
      version: version as ReviewVersion,
      files: (files as ReviewVersionFile[]).sort(
        (a, b) => a.file_order - b.file_order,
      ),
    },
  }
}

export async function getSignedDownloadUrl(args: {
  storagePath: string
  fileName?: string | null
}): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from('review-files')
    .createSignedUrl(args.storagePath, DOWNLOAD_URL_EXPIRES_SECONDS, {
      download: args.fileName ?? true,
    })
  if (error || !data?.signedUrl) {
    return { error: error?.message ?? 'No se pudo generar la URL.' }
  }
  return { ok: true, data: { url: data.signedUrl } }
}

export async function getSignedViewUrl(args: {
  storagePath: string
}): Promise<ActionResult<{ url: string }>> {
  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from('review-files')
    .createSignedUrl(args.storagePath, DOWNLOAD_URL_EXPIRES_SECONDS)
  if (error || !data?.signedUrl) {
    return { error: error?.message ?? 'No se pudo generar la URL.' }
  }
  return { ok: true, data: { url: data.signedUrl } }
}

// ─────────────────────────────────────────────────────────────────────────────
// PINS + primer COMMENT
// ─────────────────────────────────────────────────────────────────────────────

export async function createReviewPin(args: {
  versionId: string
  fileId?: string | null
  clientId: string
  posXPct: number
  posYPct: number
  timestampMs: number | null
  body: string
  mentionedUserIds?: string[]
}): Promise<ActionResult<{ pin: ReviewPin; comment: ReviewComment }>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  const body = args.body.trim()
  if (!body) return { error: 'El comentario no puede estar vacío.' }

  const { data: latestPin } = await supabase
    .from('review_pins')
    .select('pin_number')
    .eq('version_id', args.versionId)
    .order('pin_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const pinNumber = (latestPin?.pin_number ?? 0) + 1

  const { data: pin, error: pinErr } = await supabase
    .from('review_pins')
    .insert({
      version_id: args.versionId,
      file_id: args.fileId ?? null,
      pin_number: pinNumber,
      pos_x_pct: args.posXPct,
      pos_y_pct: args.posYPct,
      timestamp_ms: args.timestampMs,
      status: 'active',
      created_by: user.id,
    })
    .select('*')
    .single()

  if (pinErr || !pin) {
    return { error: pinErr?.message ?? 'Error al crear el pin.' }
  }

  const { data: comment, error: commentErr } = await supabase
    .from('review_comments')
    .insert({
      pin_id: pin.id,
      parent_id: null,
      user_id: user.id,
      body,
    })
    .select('*')
    .single()

  if (commentErr || !comment) {
    // rollback del pin si falla el comentario raíz
    await supabase.from('review_pins').delete().eq('id', pin.id)
    return { error: commentErr?.message ?? 'Error al crear el comentario.' }
  }

  const mentionIds = args.mentionedUserIds ?? []
  if (mentionIds.length > 0) {
    const { data: version } = await supabase
      .from('review_versions')
      .select('asset:review_assets(requirement_id)')
      .eq('id', args.versionId)
      .single()
    const asset = (version as unknown as { asset: { requirement_id: string } | null } | null)?.asset
    const requirementId = asset?.requirement_id
    if (requirementId) {
      await insertReviewMentions({
        commentId: comment.id,
        requirementId,
        mentionedUserIds: mentionIds,
        mentionedByUserId: user.id,
      })
    }
  }

  revalidatePath(`/clients/${args.clientId}`)
  return {
    ok: true,
    data: { pin: pin as ReviewPin, comment: comment as ReviewComment },
  }
}

export async function resolveReviewPin(args: {
  pinId: string
  clientId: string
}): Promise<ActionResult<null>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  const { error } = await supabase
    .from('review_pins')
    .update({
      status: 'resolved',
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', args.pinId)

  if (error) return { error: error.message }
  revalidatePath(`/clients/${args.clientId}`)
  return { ok: true, data: null }
}

export async function reopenReviewPin(args: {
  pinId: string
  clientId: string
}): Promise<ActionResult<null>> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('review_pins')
    .update({ status: 'active', resolved_by: null, resolved_at: null })
    .eq('id', args.pinId)

  if (error) return { error: error.message }
  revalidatePath(`/clients/${args.clientId}`)
  return { ok: true, data: null }
}

export async function deleteReviewPin(args: {
  pinId: string
  clientId: string
}): Promise<ActionResult<null>> {
  const supabase = await createClient()
  const { error } = await supabase.from('review_pins').delete().eq('id', args.pinId)
  if (error) return { error: error.message }
  revalidatePath(`/clients/${args.clientId}`)
  return { ok: true, data: null }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMMENTS (respuestas)
// ─────────────────────────────────────────────────────────────────────────────

export async function addReviewCommentReply(args: {
  pinId: string
  parentId: string
  clientId: string
  body: string
  mentionedUserIds?: string[]
}): Promise<ActionResult<ReviewComment>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  const body = args.body.trim()
  if (!body) return { error: 'La respuesta no puede estar vacía.' }

  const { data, error } = await supabase
    .from('review_comments')
    .insert({
      pin_id: args.pinId,
      parent_id: args.parentId,
      user_id: user.id,
      body,
    })
    .select('*')
    .single()

  if (error || !data) return { error: error?.message ?? 'Error al responder.' }

  const mentionIds = args.mentionedUserIds ?? []
  if (mentionIds.length > 0) {
    const { data: pinRow } = await supabase
      .from('review_pins')
      .select('version:review_versions(asset:review_assets(requirement_id))')
      .eq('id', args.pinId)
      .single()
    const requirementId = (
      pinRow as unknown as {
        version: { asset: { requirement_id: string } | null } | null
      } | null
    )?.version?.asset?.requirement_id
    if (requirementId) {
      await insertReviewMentions({
        commentId: data.id,
        requirementId,
        mentionedUserIds: mentionIds,
        mentionedByUserId: user.id,
      })
    }
  }

  revalidatePath(`/clients/${args.clientId}`)
  return { ok: true, data: data as ReviewComment }
}

export async function editReviewComment(args: {
  commentId: string
  clientId: string
  body: string
}): Promise<ActionResult<ReviewComment>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  const body = args.body.trim()
  if (!body) return { error: 'El comentario no puede estar vacío.' }

  const { data, error } = await supabase
    .from('review_comments')
    .update({ body, edited_at: new Date().toISOString() })
    .eq('id', args.commentId)
    .eq('user_id', user.id) // RLS ya lo restringe pero doble guard
    .select('*')
    .single()

  if (error || !data) return { error: error?.message ?? 'Error al editar el comentario.' }

  revalidatePath(`/clients/${args.clientId}`)
  return { ok: true, data: data as ReviewComment }
}

export async function deleteReviewComment(args: {
  commentId: string
  clientId: string
}): Promise<ActionResult<null>> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('review_comments')
    .delete()
    .eq('id', args.commentId)
  if (error) return { error: error.message }
  revalidatePath(`/clients/${args.clientId}`)
  return { ok: true, data: null }
}

export async function deleteReviewVersion(args: {
  versionId: string
  clientId: string
}): Promise<ActionResult<null>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado.' }

  const { data: appUser } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: version } = await supabase
    .from('review_versions')
    .select('id, asset_id, storage_path, thumbnail_path, uploaded_by')
    .eq('id', args.versionId)
    .single()

  if (!version) return { error: 'Versión no encontrada.' }

  const isAdmin = appUser?.role === 'admin'
  const isAuthor = version.uploaded_by === user.id
  if (!isAdmin && !isAuthor) return { error: 'Sin permisos para eliminar esta versión.' }

  // Remove storage files (legacy version columns + all review_version_files)
  const { data: verFiles } = await supabase
    .from('review_version_files')
    .select('storage_path, thumbnail_path')
    .eq('version_id', args.versionId)

  const admin = createAdminClient()
  const paths = [
    version.storage_path,
    version.thumbnail_path,
    ...(verFiles ?? []).flatMap((f) => [f.storage_path, f.thumbnail_path]),
  ].filter((p): p is string => !!p)
  const uniquePaths = Array.from(new Set(paths))
  if (uniquePaths.length > 0) {
    await admin.storage.from('review-files').remove(uniquePaths)
  }

  // Delete version row (cascade removes pins/comments if FK ON DELETE CASCADE exists)
  const { error: delErr } = await supabase
    .from('review_versions')
    .delete()
    .eq('id', args.versionId)
  if (delErr) return { error: delErr.message }

  // If it was the only version, archive the asset
  const { count } = await supabase
    .from('review_versions')
    .select('id', { count: 'exact', head: true })
    .eq('asset_id', version.asset_id)
  if ((count ?? 0) === 0) {
    await supabase
      .from('review_assets')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', version.asset_id)
  }

  revalidatePath(`/clients/${args.clientId}`)
  return { ok: true, data: null }
}
