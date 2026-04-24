'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/types/db'
import { useReviewData } from './useReviewData'
import { useReviewRealtime } from './useReviewRealtime'
import { ReviewLeftColumn } from './ReviewLeftColumn'
import { ReviewCenterViewer } from './ReviewCenterViewer'
import { ReviewRightColumn } from './ReviewRightColumn'
import { AddFilesDialog } from './AddFilesDialog'

export interface ContentReviewPanelProps {
  /** Controla cuándo activar las suscripciones realtime + fetch de usuarios. */
  active: boolean
  requirementId: string
  clientId: string
  currentUserId: string
  /** Deep-link: seleccionar este pin (y su asset/versión) al abrir. */
  initialPinId?: string | null
  /** Modo cliente (portal): última versión solamente, sin agregar archivos/versiones,
   *  sin resolver/eliminar pines. Creación de pines + respuestas permitida. */
  clientMode?: boolean
}

type UserMini = { id: string; full_name: string; avatar_url: string | null; role: UserRole }

export function ContentReviewPanel({
  active,
  requirementId,
  clientId,
  currentUserId,
  initialPinId = null,
  clientMode = false,
}: ContentReviewPanelProps) {
  const data = useReviewData(requirementId, { lastVersionOnly: clientMode })
  const [users, setUsers] = useState<UserMini[]>([])

  useEffect(() => {
    if (!active) return
    if (clientMode) return
    const supabase = createClient()
    supabase
      .from('users')
      .select('id, full_name, avatar_url, role')
      .then(({ data: rows }) => {
        if (rows) setUsers(rows as UserMini[])
      })
  }, [active, clientMode])

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [selectedPinId, setSelectedPinIdRaw] = useState<string | null>(null)
  const [addFilesOpen, setAddFilesOpen] = useState(false)
  const [addFilesMode, setAddFilesMode] = useState<
    { kind: 'new-asset' } | { kind: 'new-version'; assetId: string }
  >({ kind: 'new-asset' })

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

  const deepLinkAppliedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!active || data.loading || !initialPinId) return
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
  }, [active, data.loading, data.pinsByVersion, data.versionsByAsset, initialPinId, setSelectedPinId])

  const filesOnVersion = useMemo(
    () => (selectedVersionId ? data.filesByVersion[selectedVersionId] ?? [] : []),
    [data.filesByVersion, selectedVersionId]
  )

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
    enabled: active,
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

  function openAddFilesForNewAsset() {
    setAddFilesMode({ kind: 'new-asset' })
    setAddFilesOpen(true)
  }

  function openAddFilesForNewVersion(assetId: string) {
    setAddFilesMode({ kind: 'new-version', assetId })
    setAddFilesOpen(true)
  }

  return (
    <div className="flex flex-1 min-h-0 bg-fm-surface-container-lowest">
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
          clientMode={clientMode}
        />
      </div>

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
          clientMode={clientMode}
        />
      </div>

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
          clientMode={clientMode}
        />
      </div>

      {!clientMode && (
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
      )}
    </div>
  )
}

