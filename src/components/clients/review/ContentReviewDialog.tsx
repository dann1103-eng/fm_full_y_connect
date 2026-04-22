'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { XIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/types/db'
import { useReviewData } from './useReviewData'
import { useReviewRealtime } from './useReviewRealtime'
import { ReviewLeftColumn } from './ReviewLeftColumn'
import { ReviewCenterViewer } from './ReviewCenterViewer'
import { ReviewRightColumn } from './ReviewRightColumn'
import { AddFilesDialog } from './AddFilesDialog'

interface ContentReviewDialogProps {
  open: boolean
  onClose: () => void
  requirementId: string
  clientId: string
  requirementTitle: string
  currentUserId: string
  /** Deep-link: seleccionar este pin (y su asset/versión) al abrir. */
  initialPinId?: string | null
}

type UserMini = { id: string; full_name: string; avatar_url: string | null; role: UserRole }

export function ContentReviewDialog({
  open,
  onClose,
  requirementId,
  clientId,
  requirementTitle,
  currentUserId,
  initialPinId = null,
}: ContentReviewDialogProps) {
  const data = useReviewData(requirementId)
  const [users, setUsers] = useState<UserMini[]>([])

  useEffect(() => {
    if (!open) return
    const supabase = createClient()
    supabase
      .from('users')
      .select('id, full_name, avatar_url, role')
      .then(({ data: rows }) => {
        if (rows) setUsers(rows as UserMini[])
      })
  }, [open])

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [selectedPinId, setSelectedPinIdRaw] = useState<string | null>(null)
  const [addFilesOpen, setAddFilesOpen] = useState(false)
  const [addFilesMode, setAddFilesMode] = useState<
    { kind: 'new-asset' } | { kind: 'new-version'; assetId: string }
  >({ kind: 'new-asset' })

  // Auto-seleccionar primer asset + última versión cuando se cargan los datos
  useEffect(() => {
    if (data.loading) return
    if (data.assets.length === 0) {
      setSelectedAssetId(null)
      setSelectedVersionId(null)
      return
    }
    const currentAssetValid = data.assets.some((a) => a.id === selectedAssetId)
    const assetId = currentAssetValid ? selectedAssetId! : data.assets[0].id
    if (!currentAssetValid) setSelectedAssetId(assetId)

    const versions = data.versionsByAsset[assetId] ?? []
    if (versions.length === 0) {
      setSelectedVersionId(null)
      return
    }
    const currentVersionValid = versions.some((v) => v.id === selectedVersionId)
    if (!currentVersionValid) {
      setSelectedVersionId(versions[versions.length - 1].id)
    }
  }, [data.loading, data.assets, data.versionsByAsset, selectedAssetId, selectedVersionId])

  const selectedAsset = useMemo(
    () => data.assets.find((a) => a.id === selectedAssetId) ?? null,
    [data.assets, selectedAssetId]
  )
  const assetVersions = useMemo(
    () => (selectedAssetId ? data.versionsByAsset[selectedAssetId] ?? [] : []),
    [data.versionsByAsset, selectedAssetId]
  )
  const selectedVersion = useMemo(
    () => assetVersions.find((v) => v.id === selectedVersionId) ?? null,
    [assetVersions, selectedVersionId]
  )
  const pinsOnVersion = useMemo(
    () => (selectedVersionId ? data.pinsByVersion[selectedVersionId] ?? [] : []),
    [data.pinsByVersion, selectedVersionId]
  )
  const setSelectedPinId = useCallback(
    (pinId: string | null) => {
      if (pinId) {
        const pin = Object.values(data.pinsByVersion)
          .flat()
          .find((p) => p.id === pinId)
        if (pin?.file_id) setSelectedFileId(pin.file_id)
      }
      setSelectedPinIdRaw(pinId)
    },
    [data.pinsByVersion],
  )

  // Deep-link: si initialPinId está presente, navegar a ese pin al cargar.
  const deepLinkAppliedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!open || data.loading || !initialPinId) return
    if (deepLinkAppliedRef.current === initialPinId) return
    for (const versionId of Object.keys(data.pinsByVersion)) {
      const pin = data.pinsByVersion[versionId].find((p) => p.id === initialPinId)
      if (pin) {
        const version = Object.values(data.versionsByAsset)
          .flat()
          .find((v) => v.id === pin.version_id)
        if (version) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setSelectedAssetId(version.asset_id)
          setSelectedVersionId(version.id)
        }
        setSelectedPinId(pin.id)
        deepLinkAppliedRef.current = initialPinId
        return
      }
    }
  }, [open, data.loading, data.pinsByVersion, data.versionsByAsset, initialPinId, setSelectedPinId])

  const filesOnVersion = useMemo(
    () => (selectedVersionId ? data.filesByVersion[selectedVersionId] ?? [] : []),
    [data.filesByVersion, selectedVersionId]
  )

  // Reset selected file when version changes or files load.
  useEffect(() => {
    if (!selectedVersionId) {
      if (selectedFileId !== null) setSelectedFileId(null)
      return
    }
    if (filesOnVersion.length === 0) {
      if (selectedFileId !== null) setSelectedFileId(null)
      return
    }
    const valid = filesOnVersion.some((f) => f.id === selectedFileId)
    if (!valid) setSelectedFileId(filesOnVersion[0].id)
  }, [selectedVersionId, filesOnVersion, selectedFileId])

  const assetIds = useMemo(() => data.assets.map((a) => a.id), [data.assets])
  const versionIds = useMemo(
    () => Object.values(data.versionsByAsset).flat().map((v) => v.id),
    [data.versionsByAsset]
  )
  const pinIds = useMemo(
    () => Object.values(data.pinsByVersion).flat().map((p) => p.id),
    [data.pinsByVersion]
  )

  const onAssetRt = useCallback(
    ({ event, row }: { event: 'INSERT' | 'UPDATE' | 'DELETE'; row: typeof data.assets[number] }) => {
      if (event === 'DELETE') data.removeAsset(row.id)
      else data.upsertAsset(row)
    },
    [data]
  )
  const onVersionRt = useCallback(
    ({ event, row }: { event: 'INSERT' | 'UPDATE' | 'DELETE'; row: Parameters<typeof data.upsertVersion>[0] }) => {
      if (event === 'DELETE') return
      data.upsertVersion(row)
    },
    [data]
  )
  const onFileRt = useCallback(
    ({ event, row }: { event: 'INSERT' | 'UPDATE' | 'DELETE'; row: Parameters<typeof data.upsertFile>[0] }) => {
      if (event === 'DELETE') data.removeFile(row.id, row.version_id)
      else data.upsertFile(row)
    },
    [data]
  )
  const onPinRt = useCallback(
    ({ event, row }: { event: 'INSERT' | 'UPDATE' | 'DELETE'; row: Parameters<typeof data.upsertPin>[0] }) => {
      if (event === 'DELETE') data.removePin(row.id, row.version_id)
      else data.upsertPin(row)
    },
    [data]
  )
  const onCommentRt = useCallback(
    ({ event, row }: { event: 'INSERT' | 'UPDATE' | 'DELETE'; row: Parameters<typeof data.upsertComment>[0] }) => {
      if (event === 'DELETE') data.removeComment(row.id, row.pin_id)
      else data.upsertComment(row)
    },
    [data]
  )

  useReviewRealtime({
    enabled: open,
    requirementId,
    assetIds,
    versionIds,
    pinIds,
    onAssetChange: onAssetRt,
    onVersionChange: onVersionRt,
    onFileChange: onFileRt,
    onPinChange: onPinRt,
    onCommentChange: onCommentRt,
  })

  function handleOpenChange(next: boolean) {
    if (!next) onClose()
  }

  function openAddFilesForNewAsset() {
    setAddFilesMode({ kind: 'new-asset' })
    setAddFilesOpen(true)
  }

  function openAddFilesForNewVersion(assetId: string) {
    setAddFilesMode({ kind: 'new-version', assetId })
    setAddFilesOpen(true)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[95vw] h-[92vh] max-w-[1600px] bg-fm-surface-container-lowest rounded-2xl shadow-2xl ring-1 ring-black/10 flex flex-col overflow-hidden outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-fm-surface-container-high flex-shrink-0">
            <DialogPrimitive.Title className="text-base font-semibold text-fm-on-surface truncate">
              {selectedAsset?.name ?? requirementTitle}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="text-fm-on-surface-variant hover:text-fm-on-surface transition-colors rounded-md p-1 hover:bg-fm-surface-container"
              aria-label="Cerrar"
            >
              <XIcon className="w-5 h-5" />
            </DialogPrimitive.Close>
          </div>

          {/* ── Body: 3 columnas ── */}
          <div className="flex flex-1 min-h-0">
            {/* Izquierda: versiones/assets */}
            <div className="w-[160px] border-r border-fm-surface-container-high flex-shrink-0 flex flex-col">
              <ReviewLeftColumn
                assets={data.assets}
                versionsByAsset={data.versionsByAsset}
                pinsByVersion={data.pinsByVersion}
                selectedAssetId={selectedAssetId}
                selectedVersionId={selectedVersionId}
                clientId={clientId}
                onSelectAsset={(id) => {
                  setSelectedAssetId(id)
                  const versions = data.versionsByAsset[id] ?? []
                  setSelectedVersionId(versions[versions.length - 1]?.id ?? null)
                  setSelectedPinId(null)
                }}
                onSelectVersion={(id) => {
                  setSelectedVersionId(id)
                  setSelectedPinId(null)
                }}
                onAddAsset={openAddFilesForNewAsset}
                onAddVersion={(assetId) => openAddFilesForNewVersion(assetId)}
                onVersionDeleted={(versionId, assetId) => {
                  data.removeVersion(versionId, assetId)
                  if (selectedVersionId === versionId) {
                    const remaining = (data.versionsByAsset[assetId] ?? []).filter((v) => v.id !== versionId)
                    setSelectedVersionId(remaining[remaining.length - 1]?.id ?? null)
                    if (remaining.length === 0) setSelectedAssetId(null)
                  }
                }}
              />
            </div>

            {/* Centro: viewer */}
            <div className="flex-1 min-w-0 flex flex-col bg-fm-background">
              <ReviewCenterViewer
                loading={data.loading}
                error={data.error}
                asset={selectedAsset}
                version={selectedVersion}
                files={filesOnVersion}
                selectedFileId={selectedFileId}
                onSelectFile={(id) => {
                  setSelectedFileId(id)
                  setSelectedPinId(null)
                }}
                pins={pinsOnVersion}
                selectedPinId={selectedPinId}
                onSelectPin={setSelectedPinId}
                clientId={clientId}
                users={users}
                commentsByPin={data.commentsByPin}
                onPinCreated={(pin, comment) => {
                  data.upsertPin(pin)
                  data.upsertComment(comment)
                  setSelectedPinId(pin.id)
                }}
                onEmptyAddFiles={openAddFilesForNewAsset}
              />
            </div>

            {/* Derecha: comentarios */}
            <div className="w-[340px] border-l border-fm-surface-container-high flex-shrink-0 flex flex-col">
              <ReviewRightColumn
                pins={pinsOnVersion}
                commentsByPin={data.commentsByPin}
                selectedPinId={selectedPinId}
                onSelectPin={setSelectedPinId}
                clientId={clientId}
                currentUserId={currentUserId}
                users={users}
                onPinUpdated={data.upsertPin}
                onPinRemoved={(pinId) =>
                  selectedVersionId && data.removePin(pinId, selectedVersionId)
                }
                onCommentUpserted={data.upsertComment}
                onCommentRemoved={data.removeComment}
              />
            </div>
          </div>

          {/* Nested dialog para agregar archivos/versiones */}
          <AddFilesDialog
            open={addFilesOpen}
            onClose={() => setAddFilesOpen(false)}
            mode={addFilesMode}
            requirementId={requirementId}
            clientId={clientId}
            onUploaded={({ asset, version, files }) => {
              if (asset) {
                data.upsertAsset(asset)
                setSelectedAssetId(asset.id)
              }
              data.upsertVersion(version)
              data.setFilesForVersion(version.id, files)
              setSelectedVersionId(version.id)
              setSelectedFileId(files[0]?.id ?? null)
              setSelectedPinId(null)
            }}
          />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
