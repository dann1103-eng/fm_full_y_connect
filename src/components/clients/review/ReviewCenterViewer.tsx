'use client'

import { useEffect, useState } from 'react'
import { UploadCloudIcon } from 'lucide-react'
import type {
  ReviewAsset,
  ReviewPin,
  ReviewVersion,
  ReviewVersionFile,
  ReviewComment,
  UserRole,
} from '@/types/db'
import { ImageViewer } from './ImageViewer'
import { VideoViewer } from './VideoViewer'
import { PdfViewer } from './PdfViewer'
import { FileThumbnailStrip } from './FileThumbnailStrip'
import { diagnoseClientReview, type ClientReviewDiagnostic } from '@/app/actions/diagnoseReview'

interface UserMini {
  id: string
  full_name: string
  avatar_url: string | null
  role: UserRole
}

function DiagnosticRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className={`rounded-lg px-2.5 py-2 border ${ok ? 'border-green-500/30 bg-green-500/5' : 'border-fm-error/40 bg-fm-error/10'}`}>
      <p className={`font-semibold mb-0.5 ${ok ? 'text-green-700 dark:text-green-400' : 'text-fm-error'}`}>
        {ok ? '✓' : '✗'} {label}
      </p>
      <p className="text-fm-on-surface-variant">{detail}</p>
    </div>
  )
}

interface ReviewCenterViewerProps {
  loading: boolean
  error: string | null
  asset: ReviewAsset | null
  version: ReviewVersion | null
  files: ReviewVersionFile[]
  selectedFileId: string | null
  onSelectFile: (fileId: string) => void
  pins: ReviewPin[]
  selectedPinId: string | null
  onSelectPin: (id: string | null) => void
  clientId: string
  users: UserMini[]
  commentsByPin: Record<string, ReviewComment[]>
  onPinCreated: (pin: ReviewPin, comment: ReviewComment) => void
  onEmptyAddFiles: () => void
  clientMode?: boolean
  /** Para diagnosticar el bug de RLS cuando clientMode y no hay assets visibles. */
  requirementId?: string
  currentPdfPage: number
  onPdfPageChange: (page: number) => void
}

export function ReviewCenterViewer({
  loading,
  error,
  asset,
  version,
  files,
  selectedFileId,
  onSelectFile,
  pins,
  selectedPinId,
  onSelectPin,
  clientId,
  users,
  commentsByPin,
  onPinCreated,
  onEmptyAddFiles,
  clientMode = false,
  requirementId,
  currentPdfPage,
  onPdfPageChange,
}: ReviewCenterViewerProps) {
  const [diag, setDiag] = useState<ClientReviewDiagnostic | null>(null)

  useEffect(() => {
    // Solo en modo cliente: si terminó de cargar y no hay asset/version, diagnosticar.
    if (!clientMode || loading || asset || version || !requirementId) return
    let cancelled = false
    diagnoseClientReview(requirementId).then((d) => {
      if (!cancelled) setDiag(d)
    })
    return () => {
      cancelled = true
    }
  }, [clientMode, loading, asset, version, requirementId])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-fm-on-surface-variant text-sm">
        Cargando…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="max-w-sm text-center text-sm text-fm-error">{error}</div>
      </div>
    )
  }

  if (!asset || !version) {
    return (
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="max-w-md text-center">
          <div className="w-14 h-14 rounded-full bg-fm-primary/10 flex items-center justify-center mx-auto mb-3">
            <UploadCloudIcon className="w-7 h-7 text-fm-primary" />
          </div>
          <h3 className="text-sm font-semibold text-fm-on-surface mb-1">
            Sin archivos para revisar
          </h3>
          <p className="text-xs text-fm-on-surface-variant mb-4">
            {clientMode
              ? 'Aún no se ha cargado contenido para esta revisión.'
              : 'Sube imágenes o videos para empezar a recibir feedback con pines.'}
          </p>
          {!clientMode && (
            <button type="button"
              onClick={onEmptyAddFiles}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-fm-primary text-white text-xs font-semibold hover:bg-fm-primary-dim transition-colors"
            >
              Agregar archivos
            </button>
          )}

          {clientMode && diag && diag.totalAssets > diag.visibleAssets && (() => {
            const phaseOk = diag.phase === 'revision_cliente'
            const linkOk = diag.clientUsersRows > 0
            const cycleOk = diag.billingCycleVisible
            const allOk = phaseOk && linkOk && cycleOk

            return (
              <div className="mt-4 text-left rounded-xl border border-fm-error/30 bg-fm-error/5 p-3 text-xs space-y-2">
                <p className="font-semibold text-fm-error">Diagnóstico de acceso</p>

                <DiagnosticRow
                  ok={phaseOk}
                  label="Fase del requerimiento"
                  detail={`Fase actual: ${diag.phase ?? '—'}${!phaseOk ? ' — debe ser "revision_cliente".' : ''}`}
                />
                <DiagnosticRow
                  ok={linkOk}
                  label="Vinculación a esta marca"
                  detail={`client_users: ${diag.clientUsersRows} fila(s) · is_client_of(): ${diag.isClientOf === null ? '—' : String(diag.isClientOf)}${!linkOk ? ' — el usuario no está vinculado a esta marca.' : ''}`}
                />
                <DiagnosticRow
                  ok={cycleOk}
                  label="Ciclo de facturación visible"
                  detail={cycleOk
                    ? 'El ciclo de facturación es legible desde esta sesión.'
                    : 'El ciclo de facturación NO es legible — la política RLS de revisión falla en su JOIN interno. La migración 0055 podría no estar aplicada en la base de datos.'}
                />

                {/* Conteos y IDs */}
                <div className="text-fm-on-surface-variant space-y-0.5 pt-1 border-t border-fm-error/20">
                  <p>Archivos en BD: <strong>{diag.totalAssets}</strong> · Visibles: <strong>{diag.visibleAssets}</strong></p>
                  {diag.authUid && <p className="text-[10px] break-all">User ID: <code>{diag.authUid}</code></p>}
                  {diag.clientId && <p className="text-[10px] break-all">Client ID: <code>{diag.clientId}</code></p>}
                  {diag.cycleId && <p className="text-[10px] break-all">Cycle ID: <code>{diag.cycleId}</code></p>}
                </div>

                {(diag.selfError || diag.adminError) && (
                  <div className="pt-1 border-t border-fm-error/20 space-y-0.5">
                    {diag.selfError && <p className="text-fm-error font-medium">Error sesión: {diag.selfError}</p>}
                    {diag.adminError && <p className="text-fm-error font-medium">Error admin: {diag.adminError}</p>}
                  </div>
                )}

                <p className="text-[10px] text-fm-on-surface-variant pt-1 border-t border-fm-error/20">
                  {!phaseOk
                    ? 'Mover el requerimiento a la fase "Revisión cliente".'
                    : !linkOk
                    ? 'Vincular el usuario a esta marca en /users/portal.'
                    : !cycleOk
                    ? 'Aplicar la migración 0055 en el dashboard de Supabase (Authentication › Policies).'
                    : allOk
                    ? 'Todas las condiciones pasan pero los archivos no son visibles — verificar que la migración 0055 esté aplicada en Supabase.'
                    : 'Contactar al administrador.'}
                </p>
              </div>
            )
          })()}
        </div>
      </div>
    )
  }

  const file =
    files.find((f) => f.id === selectedFileId) ?? files[0] ?? null

  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center text-fm-on-surface-variant text-sm">
        Esta versión no tiene archivos.
      </div>
    )
  }

  const isPdf = file.mime_type === 'application/pdf'
  const isVideo = file.mime_type.startsWith('video/')

  // Para PDFs: filtrar pines por página activa (usa ?? 0 para no perder pines con page_number null)
  // Para imagen/video: filtro original
  const filePins = isPdf
    ? pins.filter(
        (p) => p.file_id === file.id && (p.page_number ?? 0) === currentPdfPage,
      )
    : pins.filter((p) => p.file_id === file.id || p.file_id == null)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 flex min-h-0">
        {isPdf ? (
          <PdfViewer
            key={file.id}
            asset={asset}
            version={version}
            file={file}
            pins={filePins}
            selectedPinId={selectedPinId}
            onSelectPin={onSelectPin}
            clientId={clientId}
            users={users}
            commentsByPin={commentsByPin}
            onPinCreated={onPinCreated}
            currentPage={currentPdfPage}
            onPageChange={onPdfPageChange}
          />
        ) : isVideo ? (
          <VideoViewer
            asset={asset}
            version={version}
            file={file}
            pins={filePins}
            selectedPinId={selectedPinId}
            onSelectPin={onSelectPin}
            clientId={clientId}
            users={users}
            commentsByPin={commentsByPin}
            onPinCreated={onPinCreated}
          />
        ) : (
          <ImageViewer
            asset={asset}
            version={version}
            file={file}
            pins={filePins}
            selectedPinId={selectedPinId}
            onSelectPin={onSelectPin}
            clientId={clientId}
            users={users}
            commentsByPin={commentsByPin}
            onPinCreated={onPinCreated}
          />
        )}
      </div>
      {/* FileThumbnailStrip no aplica para PDFs (renderizaría el archivo como imagen rota) */}
      {!isPdf && (
        <FileThumbnailStrip
          files={files}
          selectedFileId={file.id}
          onSelect={onSelectFile}
          pins={pins}
        />
      )}
    </div>
  )
}
