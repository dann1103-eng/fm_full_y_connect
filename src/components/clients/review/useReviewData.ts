'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type {
  ReviewAsset,
  ReviewVersion,
  ReviewPin,
  ReviewComment,
} from '@/types/db'

export interface ReviewDataState {
  loading: boolean
  error: string | null
  assets: ReviewAsset[]
  versionsByAsset: Record<string, ReviewVersion[]>
  pinsByVersion: Record<string, ReviewPin[]>
  commentsByPin: Record<string, ReviewComment[]>
}

export interface ReviewDataActions {
  refresh: () => Promise<void>
  upsertAsset: (asset: ReviewAsset) => void
  removeAsset: (assetId: string) => void
  upsertVersion: (version: ReviewVersion) => void
  upsertPin: (pin: ReviewPin) => void
  removePin: (pinId: string, versionId: string) => void
  upsertComment: (comment: ReviewComment) => void
  removeComment: (commentId: string, pinId: string) => void
}

export function useReviewData(requirementId: string): ReviewDataState & ReviewDataActions {
  const [assets, setAssets] = useState<ReviewAsset[]>([])
  const [versionsByAsset, setVersionsByAsset] = useState<Record<string, ReviewVersion[]>>({})
  const [pinsByVersion, setPinsByVersion] = useState<Record<string, ReviewPin[]>>({})
  const [commentsByPin, setCommentsByPin] = useState<Record<string, ReviewComment[]>>({})
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const supabase = createClient()
    setLoading(true)
    setError(null)
    try {
      const { data: assetRows, error: assetsErr } = await supabase
        .from('review_assets')
        .select('*')
        .eq('requirement_id', requirementId)
        .is('archived_at', null)
        .order('created_at', { ascending: true })
      if (assetsErr) throw assetsErr

      const assetList = (assetRows ?? []) as ReviewAsset[]
      setAssets(assetList)

      if (assetList.length === 0) {
        setVersionsByAsset({})
        setPinsByVersion({})
        setCommentsByPin({})
        return
      }

      const assetIds = assetList.map((a) => a.id)
      const { data: versionRows, error: versionsErr } = await supabase
        .from('review_versions')
        .select('*')
        .in('asset_id', assetIds)
        .order('version_number', { ascending: true })
      if (versionsErr) throw versionsErr

      const versionList = (versionRows ?? []) as ReviewVersion[]
      const versionsByAssetNext: Record<string, ReviewVersion[]> = {}
      for (const v of versionList) {
        if (!versionsByAssetNext[v.asset_id]) versionsByAssetNext[v.asset_id] = []
        versionsByAssetNext[v.asset_id].push(v)
      }
      setVersionsByAsset(versionsByAssetNext)

      if (versionList.length === 0) {
        setPinsByVersion({})
        setCommentsByPin({})
        return
      }

      const versionIds = versionList.map((v) => v.id)
      const { data: pinRows, error: pinsErr } = await supabase
        .from('review_pins')
        .select('*')
        .in('version_id', versionIds)
        .order('pin_number', { ascending: true })
      if (pinsErr) throw pinsErr

      const pinList = (pinRows ?? []) as ReviewPin[]
      const pinsByVersionNext: Record<string, ReviewPin[]> = {}
      for (const p of pinList) {
        if (!pinsByVersionNext[p.version_id]) pinsByVersionNext[p.version_id] = []
        pinsByVersionNext[p.version_id].push(p)
      }
      setPinsByVersion(pinsByVersionNext)

      if (pinList.length === 0) {
        setCommentsByPin({})
        return
      }

      const pinIds = pinList.map((p) => p.id)
      const { data: commentRows, error: commentsErr } = await supabase
        .from('review_comments')
        .select('*')
        .in('pin_id', pinIds)
        .order('created_at', { ascending: true })
      if (commentsErr) throw commentsErr

      const commentList = (commentRows ?? []) as ReviewComment[]
      const commentsByPinNext: Record<string, ReviewComment[]> = {}
      for (const c of commentList) {
        if (!commentsByPinNext[c.pin_id]) commentsByPinNext[c.pin_id] = []
        commentsByPinNext[c.pin_id].push(c)
      }
      setCommentsByPin(commentsByPinNext)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar la revisión.')
    } finally {
      setLoading(false)
    }
  }, [requirementId])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Optimistic local updates (antes del realtime ACK)
  const upsertAsset = useCallback((asset: ReviewAsset) => {
    setAssets((prev) => {
      const existing = prev.findIndex((a) => a.id === asset.id)
      if (existing >= 0) {
        const next = [...prev]
        next[existing] = asset
        return next
      }
      return [...prev, asset]
    })
  }, [])

  const removeAsset = useCallback((assetId: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== assetId))
  }, [])

  const upsertVersion = useCallback((version: ReviewVersion) => {
    setVersionsByAsset((prev) => {
      const current = prev[version.asset_id] ?? []
      const idx = current.findIndex((v) => v.id === version.id)
      let next: ReviewVersion[]
      if (idx >= 0) {
        next = [...current]
        next[idx] = version
      } else {
        next = [...current, version]
      }
      next.sort((a, b) => a.version_number - b.version_number)
      return { ...prev, [version.asset_id]: next }
    })
  }, [])

  const upsertPin = useCallback((pin: ReviewPin) => {
    setPinsByVersion((prev) => {
      const current = prev[pin.version_id] ?? []
      const idx = current.findIndex((p) => p.id === pin.id)
      let next: ReviewPin[]
      if (idx >= 0) {
        next = [...current]
        next[idx] = pin
      } else {
        next = [...current, pin]
      }
      next.sort((a, b) => a.pin_number - b.pin_number)
      return { ...prev, [pin.version_id]: next }
    })
  }, [])

  const removePin = useCallback((pinId: string, versionId: string) => {
    setPinsByVersion((prev) => {
      const current = prev[versionId] ?? []
      return { ...prev, [versionId]: current.filter((p) => p.id !== pinId) }
    })
    setCommentsByPin((prev) => {
      const next = { ...prev }
      delete next[pinId]
      return next
    })
  }, [])

  const upsertComment = useCallback((comment: ReviewComment) => {
    setCommentsByPin((prev) => {
      const current = prev[comment.pin_id] ?? []
      const idx = current.findIndex((c) => c.id === comment.id)
      let next: ReviewComment[]
      if (idx >= 0) {
        next = [...current]
        next[idx] = comment
      } else {
        next = [...current, comment]
      }
      next.sort((a, b) => a.created_at.localeCompare(b.created_at))
      return { ...prev, [comment.pin_id]: next }
    })
  }, [])

  const removeComment = useCallback((commentId: string, pinId: string) => {
    setCommentsByPin((prev) => {
      const current = prev[pinId] ?? []
      return { ...prev, [pinId]: current.filter((c) => c.id !== commentId) }
    })
  }, [])

  const state = useMemo(
    () => ({ loading, error, assets, versionsByAsset, pinsByVersion, commentsByPin }),
    [loading, error, assets, versionsByAsset, pinsByVersion, commentsByPin]
  )

  return {
    ...state,
    refresh,
    upsertAsset,
    removeAsset,
    upsertVersion,
    upsertPin,
    removePin,
    upsertComment,
    removeComment,
  }
}
