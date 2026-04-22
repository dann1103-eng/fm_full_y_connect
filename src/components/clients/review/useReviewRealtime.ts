'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type {
  ReviewAsset,
  ReviewVersion,
  ReviewPin,
  ReviewComment,
} from '@/types/db'

interface UseReviewRealtimeParams {
  enabled: boolean
  requirementId: string
  assetIds: string[]
  versionIds: string[]
  pinIds: string[]
  onAssetChange: (payload: {
    event: 'INSERT' | 'UPDATE' | 'DELETE'
    row: ReviewAsset
  }) => void
  onVersionChange: (payload: {
    event: 'INSERT' | 'UPDATE' | 'DELETE'
    row: ReviewVersion
  }) => void
  onPinChange: (payload: {
    event: 'INSERT' | 'UPDATE' | 'DELETE'
    row: ReviewPin
  }) => void
  onCommentChange: (payload: {
    event: 'INSERT' | 'UPDATE' | 'DELETE'
    row: ReviewComment
  }) => void
}

/**
 * Suscribe un canal realtime para la feature de revisión.
 * Filtra por `requirement_id` en assets y propaga cambios relacionados
 * solo si pertenecen a los IDs conocidos en el estado local.
 */
export function useReviewRealtime({
  enabled,
  requirementId,
  assetIds,
  versionIds,
  pinIds,
  onAssetChange,
  onVersionChange,
  onPinChange,
  onCommentChange,
}: UseReviewRealtimeParams) {
  useEffect(() => {
    if (!enabled) return
    const supabase = createClient()
    const assetSet = new Set(assetIds)
    const versionSet = new Set(versionIds)
    const pinSet = new Set(pinIds)

    const channel = supabase
      .channel(`review:${requirementId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'review_assets',
          filter: `requirement_id=eq.${requirementId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as ReviewAsset
          onAssetChange({
            event: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
            row,
          })
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'review_versions' },
        (payload) => {
          const row = (payload.new ?? payload.old) as ReviewVersion
          if (!assetSet.has(row.asset_id)) return
          onVersionChange({
            event: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
            row,
          })
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'review_pins' },
        (payload) => {
          const row = (payload.new ?? payload.old) as ReviewPin
          if (!versionSet.has(row.version_id)) return
          onPinChange({
            event: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
            row,
          })
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'review_comments' },
        (payload) => {
          const row = (payload.new ?? payload.old) as ReviewComment
          if (!pinSet.has(row.pin_id)) return
          onCommentChange({
            event: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
            row,
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [
    enabled,
    requirementId,
    // joined for Set membership only; stringify for stable deps
    assetIds.join(','),
    versionIds.join(','),
    pinIds.join(','),
    onAssetChange,
    onVersionChange,
    onPinChange,
    onCommentChange,
  ])
}
