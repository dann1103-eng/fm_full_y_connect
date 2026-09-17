'use client'

import { useEffect, useState } from 'react'
import type { TargetPeriod } from '@/lib/domain/matrix'
import { listTargetPeriods } from '@/app/actions/matrices'

const LOAD_ERROR = 'No se pudieron cargar los períodos. Revisa tu conexión e intenta de nuevo.'

type Loaded =
  | { clientId: string; attempt: number; ok: true; periods: TargetPeriod[]; existing: Record<string, string> }
  | { clientId: string; attempt: number; ok: false; error: string }

const NO_EXISTING: Record<string, string> = {}

/**
 * Períodos objetivo de un cliente (vigente + siguientes) y matrices existentes por `periodStart`.
 * El resultado se guarda etiquetado con cliente e intento: "cargando" se deriva (no hay setState síncrono en
 * el efecto) y `retry` solo avanza el intento.
 */
export function useTargetPeriods(clientId: string) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!clientId) return
    let cancelled = false
    listTargetPeriods(clientId)
      .then((r) => {
        if (cancelled) return
        setLoaded(r.ok
          ? { clientId, attempt, ok: true, periods: r.periods, existing: r.existing }
          : { clientId, attempt, ok: false, error: r.error })
      })
      .catch((e: unknown) => {
        console.error('[useTargetPeriods]', e)
        if (!cancelled) setLoaded({ clientId, attempt, ok: false, error: LOAD_ERROR })
      })
    return () => { cancelled = true }
  }, [clientId, attempt])

  const current = loaded && loaded.clientId === clientId && loaded.attempt === attempt ? loaded : null
  return {
    loading: !!clientId && !current,
    periods: current?.ok ? current.periods : [],
    existing: current?.ok ? current.existing : NO_EXISTING,
    error: current && !current.ok ? current.error : null,
    retry: () => setAttempt((a) => a + 1),
  }
}
