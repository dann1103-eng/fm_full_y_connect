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
 * Usa el cliente admin (service role) para TODAS las operaciones:
 *   - Bypasea RLS completamente — funciona sin importar el rol del usuario que renueva.
 *   - requirement-attachments tiene DELETE restringido a role='admin' en storage policy;
 *     supervisores que renuevan pasarían por esa restricción con client normal.
 *   - review-files es bucket privado y requiere service role para operaciones de cleanup.
 */

import { createAdminClient } from './admin'

export async function cleanupCycleStorage(
  requirementIds: string[],
): Promise<void> {
  if (requirementIds.length === 0) return

  // Siempre usamos service role: bypass RLS total en storage y DB
  const admin = createAdminClient()

  // ── 1. requirement-attachments ──────────────────────────────────────────────
  // Estructura: {requirementId}/{uuid}.jpg
  // Listamos carpeta por requerimiento y borramos todos los archivos encontrados.
  for (const reqId of requirementIds) {
    try {
      const { data: files } = await admin.storage
        .from('requirement-attachments')
        .list(reqId)
      if (files && files.length > 0) {
        const paths = files.map((f) => `${reqId}/${f.name}`)
        const { error } = await admin.storage
          .from('requirement-attachments')
          .remove(paths)
        if (error) console.error(`[cleanup] requirement-attachments req ${reqId}:`, error.message)
      }
    } catch (err) {
      console.error(`[cleanup] requirement-attachments req ${reqId}:`, err)
    }
  }

  // ── 2. review-files ─────────────────────────────────────────────────────────
  // Los paths están registrados en DB:
  //   review_assets → review_versions → review_version_files
  // Leemos con admin client (bypasea RLS en todas las tablas).
  try {
    // 2a. Assets de estos requerimientos
    const { data: assets } = await admin
      .from('review_assets')
      .select('id')
      .in('requirement_id', requirementIds)
    const assetIds = (assets ?? []).map((a: { id: string }) => a.id)
    if (assetIds.length === 0) return

    // 2b. Versions (paths legacy single-file + thumbnail en la propia fila)
    const { data: versions } = await admin
      .from('review_versions')
      .select('id, storage_path, thumbnail_path')
      .in('asset_id', assetIds)
    const versionIds = (versions ?? []).map((v: { id: string }) => v.id)

    // 2c. Version files (paths multi-file desde tabla satélite)
    const { data: versionFiles } = versionIds.length > 0
      ? await admin
          .from('review_version_files')
          .select('storage_path, thumbnail_path')
          .in('version_id', versionIds)
      : { data: [] }

    // 2d. Recolectar paths únicos y no nulos
    const allPaths = [
      ...(versions ?? []).flatMap((v: { storage_path: string | null; thumbnail_path: string | null }) =>
        [v.storage_path, v.thumbnail_path]),
      ...(versionFiles ?? []).flatMap((f: { storage_path: string | null; thumbnail_path: string | null }) =>
        [f.storage_path, f.thumbnail_path]),
    ].filter((p): p is string => !!p)

    const uniquePaths = Array.from(new Set(allPaths))
    if (uniquePaths.length > 0) {
      // Supabase remove acepta hasta 1000 paths por llamada
      const BATCH = 1000
      for (let i = 0; i < uniquePaths.length; i += BATCH) {
        const { error } = await admin.storage
          .from('review-files')
          .remove(uniquePaths.slice(i, i + BATCH))
        if (error) console.error(`[cleanup] review-files batch ${i}:`, error.message)
      }
    }
  } catch (err) {
    console.error('[cleanup] review-files:', err)
  }
}
