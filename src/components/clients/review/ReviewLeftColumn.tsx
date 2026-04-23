'use client'

import { useState } from 'react'
import { PlusIcon, DownloadIcon, ChevronLeftIcon, Trash2Icon } from 'lucide-react'
import type { ReviewAsset, ReviewVersion, ReviewPin } from '@/types/db'
import { AssetThumbnail } from './AssetThumbnail'
import { getSignedDownloadUrl, deleteReviewVersion } from '@/app/actions/content-review'
import { useUser } from '@/contexts/UserContext'

interface ReviewLeftColumnProps {
  assets: ReviewAsset[]
  versionsByAsset: Record<string, ReviewVersion[]>
  pinsByVersion: Record<string, ReviewPin[]>
  selectedAssetId: string | null
  selectedVersionId: string | null
  clientId: string
  onSelectAsset: (assetId: string) => void
  onSelectVersion: (versionId: string) => void
  onAddAsset: () => void
  onAddVersion: (assetId: string) => void
  onVersionDeleted: (versionId: string, assetId: string) => void
}

export function ReviewLeftColumn({
  assets,
  versionsByAsset,
  pinsByVersion,
  selectedAssetId,
  selectedVersionId,
  clientId,
  onSelectAsset,
  onSelectVersion,
  onAddAsset,
  onAddVersion,
  onVersionDeleted,
}: ReviewLeftColumnProps) {
  const user = useUser()
  const [collapsed, setCollapsed] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const selectedAsset = assets.find((a) => a.id === selectedAssetId) ?? null
  const selectedVersions = selectedAssetId ? versionsByAsset[selectedAssetId] ?? [] : []
  const latestVersion = selectedVersions[selectedVersions.length - 1] ?? null

  async function handleDownload() {
    if (!latestVersion) return
    const ext = latestVersion.storage_path.split('.').pop() ?? ''
    const baseName = selectedAsset
      ? `${selectedAsset.name}-v${latestVersion.version_number}`
      : `archivo-v${latestVersion.version_number}`
    const res = await getSignedDownloadUrl({
      storagePath: latestVersion.storage_path,
      fileName: ext ? `${baseName}.${ext}` : baseName,
    })
    if ('ok' in res) {
      window.open(res.data.url, '_blank', 'noopener,noreferrer')
    }
  }

  async function handleDeleteVersion(version: ReviewVersion) {
    if (!window.confirm('¿Eliminar esta versión? Esta acción no se puede deshacer.')) return
    setDeletingId(version.id)
    const res = await deleteReviewVersion({ versionId: version.id, clientId })
    setDeletingId(null)
    if ('error' in res) {
      alert(res.error)
      return
    }
    onVersionDeleted(version.id, version.asset_id)
  }

  function canDeleteVersion(version: ReviewVersion): boolean {
    return user.role === 'admin' || version.uploaded_by === user.id
  }

  if (collapsed) {
    return (
      <div className="h-full flex items-start justify-center pt-4">
        <button
          onClick={() => setCollapsed(false)}
          className="text-fm-on-surface-variant hover:text-fm-on-surface p-1 rounded hover:bg-fm-surface-container"
          aria-label="Expandir"
        >
          <ChevronLeftIcon className="w-4 h-4 rotate-180" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Dropdown "Última versión" */}
      <div className="px-3 pt-3 pb-2 border-b border-fm-surface-container-high/60 flex items-center justify-between">
        <span className="text-xs font-semibold text-fm-on-surface">Última versión</span>
        <button
          onClick={() => setCollapsed(true)}
          className="text-fm-on-surface-variant hover:text-fm-on-surface p-1 rounded hover:bg-fm-surface-container"
          aria-label="Colapsar"
        >
          <ChevronLeftIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Lista de assets + versiones */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {assets.length === 0 ? (
          <div className="text-center text-xs text-fm-on-surface-variant py-6">
            Sin archivos todavía
          </div>
        ) : (
          assets.map((asset) => {
            const versions = versionsByAsset[asset.id] ?? []
            const isSelectedAsset = asset.id === selectedAssetId
            return (
              <div key={asset.id} className="space-y-2">
                {versions.map((version, idx) => {
                  const isLatest = idx === versions.length - 1
                  const isSelected =
                    isSelectedAsset && version.id === selectedVersionId
                  return (
                    <div key={version.id} className="space-y-1">
                      <button
                        onClick={() => {
                          onSelectAsset(asset.id)
                          onSelectVersion(version.id)
                        }}
                        className={`relative w-full rounded-md overflow-hidden ring-offset-2 transition-all ${
                          isSelected
                            ? 'ring-2 ring-fm-primary'
                            : 'ring-1 ring-fm-surface-container-high hover:ring-fm-on-surface-variant'
                        }`}
                      >
                        <AssetThumbnail asset={asset} version={version} />
                        <div className="absolute top-1 right-1 bg-black/60 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">
                          v{version.version_number}
                        </div>
                      </button>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] font-medium text-fm-on-surface truncate">
                          {asset.name}
                        </span>
                        <span className="text-[9px] text-fm-on-surface-variant uppercase tracking-wide">
                          {asset.kind === 'video' ? 'Video' : 'Img'}
                        </span>
                      </div>
                      {isLatest && isSelectedAsset && (
                        <div className="flex gap-1">
                          <button
                            onClick={handleDownload}
                            className="flex-1 flex items-center justify-center gap-1 text-[10px] font-semibold text-fm-primary hover:bg-fm-primary/10 py-1.5 rounded transition-colors"
                            title="Descargar última versión"
                          >
                            <DownloadIcon className="w-3 h-3" />
                            Descargar
                          </button>
                          {canDeleteVersion(version) && (
                            <button
                              onClick={() => handleDeleteVersion(version)}
                              disabled={deletingId === version.id}
                              className="flex items-center justify-center px-2 py-1.5 rounded text-[#b31b25] hover:bg-[#b31b25]/10 transition-colors disabled:opacity-40"
                              title="Eliminar versión"
                            >
                              <Trash2Icon className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
                {isSelectedAsset && (() => {
                  const latestV = versions[versions.length - 1]
                  const latestHasActivePins = latestV
                    ? (pinsByVersion[latestV.id] ?? []).some((p) => p.status === 'active')
                    : false
                  return (
                    <button
                      onClick={() => onAddVersion(asset.id)}
                      disabled={latestHasActivePins}
                      title={
                        latestHasActivePins
                          ? 'Resuelve los pines activos antes de subir una nueva versión'
                          : undefined
                      }
                      className="w-full flex items-center justify-center gap-1 py-2 rounded-md border border-dashed border-fm-surface-container-high text-fm-primary hover:bg-fm-primary/5 hover:border-fm-primary/50 transition-colors text-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-fm-surface-container-high"
                    >
                      <PlusIcon className="w-3.5 h-3.5" />
                      Nueva versión
                    </button>
                  )
                })()}
              </div>
            )
          })
        )}
      </div>

      {/* Botón agregar archivo global */}
      <div className="p-3 border-t border-fm-surface-container-high/60">
        <button
          onClick={onAddAsset}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-full bg-fm-primary text-white text-xs font-semibold hover:bg-fm-primary-dim transition-colors"
        >
          <PlusIcon className="w-4 h-4" />
          Agregar
        </button>
      </div>
    </div>
  )
}
