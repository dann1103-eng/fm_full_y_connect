'use client'

import { useState } from 'react'
import { PlusIcon, DownloadIcon, ChevronLeftIcon } from 'lucide-react'
import type { ReviewAsset, ReviewVersion } from '@/types/db'
import { AssetThumbnail } from './AssetThumbnail'
import { getSignedDownloadUrl } from '@/app/actions/content-review'

interface ReviewLeftColumnProps {
  assets: ReviewAsset[]
  versionsByAsset: Record<string, ReviewVersion[]>
  selectedAssetId: string | null
  selectedVersionId: string | null
  onSelectAsset: (assetId: string) => void
  onSelectVersion: (versionId: string) => void
  onAddAsset: () => void
  onAddVersion: (assetId: string) => void
}

export function ReviewLeftColumn({
  assets,
  versionsByAsset,
  selectedAssetId,
  selectedVersionId,
  onSelectAsset,
  onSelectVersion,
  onAddAsset,
  onAddVersion,
}: ReviewLeftColumnProps) {
  const [collapsed, setCollapsed] = useState(false)

  const selectedAsset = assets.find((a) => a.id === selectedAssetId) ?? null
  const selectedVersions = selectedAssetId ? versionsByAsset[selectedAssetId] ?? [] : []
  const latestVersion = selectedVersions[selectedVersions.length - 1] ?? null

  async function handleDownload() {
    if (!latestVersion) return
    const res = await getSignedDownloadUrl({
      storagePath: latestVersion.storage_path,
      fileName: selectedAsset ? `${selectedAsset.name}-v${latestVersion.version_number}` : null,
    })
    if ('ok' in res) {
      window.open(res.data.url, '_blank', 'noopener,noreferrer')
    }
  }

  if (collapsed) {
    return (
      <div className="h-full flex items-start justify-center pt-4">
        <button
          onClick={() => setCollapsed(false)}
          className="text-[#595c5e] hover:text-[#2a2a2a] p-1 rounded hover:bg-[#f5f7f9]"
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
      <div className="px-3 pt-3 pb-2 border-b border-[#dfe3e6]/60 flex items-center justify-between">
        <span className="text-xs font-semibold text-[#2a2a2a]">Última versión</span>
        <button
          onClick={() => setCollapsed(true)}
          className="text-[#595c5e] hover:text-[#2a2a2a] p-1 rounded hover:bg-[#f5f7f9]"
          aria-label="Colapsar"
        >
          <ChevronLeftIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Lista de assets + versiones */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {assets.length === 0 ? (
          <div className="text-center text-xs text-[#8a8f93] py-6">
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
                            ? 'ring-2 ring-[#00675c]'
                            : 'ring-1 ring-[#dfe3e6] hover:ring-[#8a8f93]'
                        }`}
                      >
                        <AssetThumbnail asset={asset} version={version} />
                        <div className="absolute top-1 right-1 bg-black/60 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">
                          v{version.version_number}
                        </div>
                      </button>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] font-medium text-[#2a2a2a] truncate">
                          {asset.name}
                        </span>
                        <span className="text-[9px] text-[#8a8f93] uppercase tracking-wide">
                          {asset.kind === 'video' ? 'Video' : 'Img'}
                        </span>
                      </div>
                      {isLatest && isSelectedAsset && (
                        <button
                          onClick={handleDownload}
                          className="w-full flex items-center justify-center gap-1 text-[10px] font-semibold text-[#00675c] hover:bg-[#00675c]/10 py-1.5 rounded transition-colors"
                          title="Descargar última versión"
                        >
                          <DownloadIcon className="w-3 h-3" />
                          Descargar
                        </button>
                      )}
                    </div>
                  )
                })}
                {isSelectedAsset && (
                  <button
                    onClick={() => onAddVersion(asset.id)}
                    className="w-full flex items-center justify-center gap-1 py-2 rounded-md border border-dashed border-[#dfe3e6] text-[#00675c] hover:bg-[#00675c]/5 hover:border-[#00675c]/50 transition-colors text-xs"
                  >
                    <PlusIcon className="w-3.5 h-3.5" />
                    Nueva versión
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Botón agregar archivo global */}
      <div className="p-3 border-t border-[#dfe3e6]/60">
        <button
          onClick={onAddAsset}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-full bg-[#00675c] text-white text-xs font-semibold hover:bg-[#004d45] transition-colors"
        >
          <PlusIcon className="w-4 h-4" />
          Agregar
        </button>
      </div>
    </div>
  )
}
