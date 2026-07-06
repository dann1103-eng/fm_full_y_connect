'use client'

import { useSyncExternalStore } from 'react'
import { getMyActiveShift } from '@/app/actions/work-sessions'
import type { WorkSession } from '@/types/db'

/**
 * Fuente de verdad ÚNICA (a nivel de módulo) de la jornada activa del usuario.
 *
 * Antes cada consumidor (widget del header, ShiftPanel, ClockInPanel) leía
 * `getMyActiveShift()` en su propio `useEffect([])` y se quedaba con ese valor
 * congelado: iniciar/finalizar la jornada en un lado no se reflejaba en el otro
 * (`router.refresh()` re-renderiza server components, pero NO re-ejecuta un
 * `useEffect([])` de un client component). Resultado: estados descoordinados y
 * el botón "Marcar entrada" bloqueado a pesar de tener jornada activa.
 *
 * Con este store TODOS los componentes comparten el mismo valor y una sola
 * ruta de refresco: un `notifyShiftChanged()` tras cualquier mutación actualiza
 * a todos al instante (y a otras pestañas del navegador vía BroadcastChannel).
 */

export interface ActiveShiftState {
  shift: WorkSession | null
  loading: boolean
}

const POLL_INTERVAL_MS = 30_000
const CHANNEL_NAME = 'fm-workshift'

// Snapshot estable: solo se reemplaza la referencia cuando cambia algo
// relevante, para cumplir el contrato de useSyncExternalStore (getSnapshot
// debe devolver la MISMA referencia mientras el store no cambie).
const SERVER_SNAPSHOT: ActiveShiftState = { shift: null, loading: true }
let snapshot: ActiveShiftState = { shift: null, loading: true }

const listeners = new Set<() => void>()
let fetching = false
let pollTimer: ReturnType<typeof setInterval> | null = null
let channel: BroadcastChannel | null = null

function shiftSignature(s: WorkSession | null): string {
  if (!s) return 'none'
  return [s.id, s.status, s.started_at, s.ended_at ?? '', JSON.stringify(s.breaks_json ?? [])].join('|')
}

function commit(next: ActiveShiftState) {
  if (
    snapshot.loading === next.loading &&
    shiftSignature(snapshot.shift) === shiftSignature(next.shift)
  ) {
    return // sin cambios relevantes: conservar la misma referencia (evita renders)
  }
  snapshot = next
  for (const listener of listeners) listener()
}

/** Refetch de la jornada activa. Notifica a TODOS los suscriptores del tab. */
export async function refreshActiveShift(): Promise<void> {
  if (fetching) return
  fetching = true
  try {
    const shift = await getMyActiveShift()
    commit({ shift, loading: false })
  } catch {
    // Ante un error de red conservamos el último valor pero salimos de loading.
    commit({ shift: snapshot.shift, loading: false })
  } finally {
    fetching = false
  }
}

/**
 * Notifica que la jornada cambió (tras iniciar/finalizar/pausar/reanudar).
 * Refetch local inmediato + ping a otras pestañas del mismo navegador.
 */
export function notifyShiftChanged(): void {
  void refreshActiveShift()
  try {
    channel?.postMessage('changed')
  } catch {
    /* BroadcastChannel puede no estar disponible; no es crítico */
  }
}

/** Lectura sincrónica del snapshot actual (útil fuera de React y en tests). */
export function peekActiveShift(): ActiveShiftState {
  return snapshot
}

function handleVisibility() {
  if (document.visibilityState === 'visible') void refreshActiveShift()
}

/** Suscripción de bajo nivel (contrato useSyncExternalStore). Exportada para tests. */
export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  if (listeners.size === 1) {
    // Primer suscriptor del tab: arrancar la sincronización compartida.
    void refreshActiveShift()
    pollTimer = setInterval(() => void refreshActiveShift(), POLL_INTERVAL_MS)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility)
    }
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME)
      channel.onmessage = () => void refreshActiveShift()
    }
  }
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility)
      }
      if (channel) {
        channel.close()
        channel = null
      }
    }
  }
}

function getSnapshot(): ActiveShiftState {
  return snapshot
}

function getServerSnapshot(): ActiveShiftState {
  return SERVER_SNAPSHOT
}

/**
 * Hook que devuelve la jornada activa compartida y una función `refresh`.
 * Todos los componentes que lo usan comparten el mismo estado.
 */
export function useActiveShift(): ActiveShiftState & { refresh: () => Promise<void> } {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return { shift: state.shift, loading: state.loading, refresh: refreshActiveShift }
}
