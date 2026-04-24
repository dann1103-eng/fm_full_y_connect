/**
 * cleanupCycleStorage
 * -------------------
 * Borra todos los archivos temporales de storage asociados a un conjunto de
 * requerimientos al archivar un ciclo. Los archivos son de trabajo activo y
 * no deben permanecer una vez que el ciclo cierra; el proyecto final se guarda
 * en otro sistema externo.
 *
 * Buckets limpiados:
 *   - requirement-attachments/{reqId}/*   (adjuntos del chat de requerimiento)
 *   - review-files/*                      (versiones subidas a revisión de contenido)
 *
 * Usa el cliente admin (service role) para el bucket privado review-files.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from './admin'

export async function cleanupCycleStorage(
  supabase: SupabaseClient,
  requirementIds: string[],
): Promise<void> {
  if (requirementIds.length === 0) return

  // ── 1. requirement-attachments ──────────────────────────────────────────────
  // Estructura: {requirementId}/{uuid}.jpg
  // Listamos una carpeta por requerimiento y borramos todos los archivos.
  for (const reqId of requirementIds) {
    try {
      const { data: files } = await supabase.storage
        .from('requirement-attachments')
        .list(reqId)
      if (files && files.length > 0) {
        const paths = files.map((f) => `${reqId}/${f.name}`)
        await supabase.storage.from('requirement-attachments').remove(paths)
      }
    } catch (err) {
      // No bloquear la renovación si falla un cleanup
      console.error(`[cleanup] requirement-attachments para req ${reqId}:`, err)
    }
  }

  // ── 2. review-files ─────────────────────────────────────────────────────────
  // Estructura: paths registrados en review_versions.storage_path /thumbnail_path
  // y review_version_files.storage_path / thumbnail_path.
  // Usamos el cliente admin porque el bucket es privado.
  try {
    const admin = createAdminClient()

    // 2a. Obtener IDs de assets para estos requerimientos
    const { data: assets } = await supabase
      .from('review_assets')
      .select('id')
      .in('requirement_id', requirementIds)
    const assetIds = (assets ?? []).map((a) => a.id)
    if (assetIds.length === 0) return

    // 2b. Obtener paths de review_versions (legacy single-file + thumbnail)
    const { data: versions } = await supabase
      .from('review_versions')
      .select('id, storage_path, thumbnail_path')
      .in('asset_id', assetIds)
    const versionIds = (versions ?? []).map((v) => v.id)

    // 2c. Obtener paths de review_version_files (multi-file por versión)
    const { data: versionFiles } = versionIds.length > 0
      ? await supabase
          .from('review_version_files')
          .select('storage_path, thumbnail_path')
          .in('version_id', versionIds)
      : { data: [] }

    // 2d. Recolectar todos los paths únicos y no nulos
    const allPaths = [
      ...(versions ?? []).flatMap((v) => [v.storage_path, v.thumbnail_path]),
      ...(versionFiles ?? []).flatMap((f) => [f.storage_path, f.thumbnail_path]),
    ].filter((p): p is string => !!p)

    const uniquePaths = Array.from(new Set(allPaths))
    if (uniquePaths.length > 0) {
      // Supabase remove acepta hasta 1000 paths por llamada
      const BATCH = 1000
      for (let i = 0; i < uniquePaths.length; i += BATCH) {
        await admin.storage.from('review-files').remove(uniquePaths.slice(i, i + BATCH))
      }
    }
  } catch (err) {
    console.error('[cleanup] review-files:', err)
  }
}
