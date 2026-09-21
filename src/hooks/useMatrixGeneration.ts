'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { isGenerationLive, type GenerationProgress } from '@/lib/domain/matrix-generation'

/** Cada cuánto se sondea mientras hay generación viva. */
const POLL_MS = 3_000
/** Tope del reintento con espera creciente tras un 500 o un fallo de red. */
const MAX_RETRY_MS = 30_000

/** Estado optimista tras encolar, hasta que llegue la primera respuesta. */
export type GenerationKick = { planning: true } | { writingItemId: string }

interface Options {
  /** Matriz no cerrada: consulta al montar y sondeo mientras haya trabajo vivo. */
  enabled: boolean
  /** Máximo `updated_at` de las filas del render del servidor. Solo se lee al montar. */
  initialSince: string | null
  /** Secuencia de cambios locales del editor, leída al ENVIAR cada consulta (ver `FieldLocks.stale`). */
  captureSeq: () => number
  /** Cada respuesta buena, con la secuencia capturada al enviarla. */
  onUpdate: (progress: GenerationProgress, seqAtRequest: number) => void
}

export interface MatrixGeneration {
  /** Última respuesta (o el estado optimista de un `kick`). `null` hasta la primera. */
  progress: GenerationProgress | null
  /**
   * Esta pestaña lanzó una generación o la vio viva. Decide si se muestra el motivo con que terminó el
   * padre: sin esto, el `cupo_cubierto` de una corrida de hace un mes saldría en cada visita.
   */
  observed: boolean
  /** Enciende el sondeo ya, sin esperar al siguiente tick (tras encolar un padre o un hijo). */
  kick: (hint?: GenerationKick) => void
}

const IDLE: GenerationProgress = {
  phase: 'idle', total: 0, done: 0, failed: 0, writingItemIds: [], itemJobs: [], failedItems: [], error: null,
  reason: null, topics: null, matrixUpdatedAt: null, items: [], watermark: null,
}

function optimistic(p: GenerationProgress | null, hint: GenerationKick): GenerationProgress {
  const base = p ?? IDLE
  if ('planning' in hint) return { ...base, phase: 'planning', total: 0, done: 0, failed: 0, error: null, reason: null }
  const id = hint.writingItemId
  return {
    ...base,
    writingItemIds: base.writingItemIds.includes(id) ? base.writingItemIds : [...base.writingItemIds, id],
    failedItems: base.failedItems.filter((f) => f.itemId !== id),
  }
}

/**
 * Sondeo del progreso de la generación con IA de una matriz (bloque 3), con la forma de
 * `useNotifications`: `AbortController` que cancela la petición anterior, pausa con la pestaña oculta
 * y reanudación al volver, y limpieza completa al desmontar.
 *
 * - **Arranque**: una consulta al montar (barata: solo trae las filas posteriores al render del
 *   servidor) y, si hay algo vivo, sondeo cada 3 s. Sin ella, cerrar la pestaña a media generación y
 *   volver mostraría una matriz a medio redactar sin avisar de que sigue en curso.
 * - **Vida**: `isGenerationLive` (padre planificando o algún hijo vivo), nunca `phase` sola.
 * - **Marca de agua**: la `watermark` de la respuesta tal cual; si no vino ninguna fila, se conserva la
 *   anterior. Nunca del reloj del navegador.
 * - **Errores**: un 500 o un fallo de red NO es "terminado": se conserva el último estado y se
 *   reintenta con espera creciente. Un 4xx (sin sesión, sin permiso, matriz borrada) apaga el sondeo:
 *   reintentar no lo arregla.
 * - **Asentamiento**: cuando una generación que se vio viva termina, una última consulta SIN `since`
 *   trae la matriz entera una vez. La marca de agua por `updated_at` tiene una carrera estrecha pero
 *   real con los hijos en paralelo (una escritura cuya transacción empezó antes que otra ya visible,
 *   pero confirmó después de la lectura, queda por debajo de la marca), y esa fila no volvería nunca.
 */
export function useMatrixGeneration(matrixId: string, { enabled, initialSince, captureSeq, onUpdate }: Options): MatrixGeneration {
  const [progress, setProgress] = useState<GenerationProgress | null>(null)
  const [observed, setObserved] = useState(false)

  const sinceRef = useRef(initialSince)
  const captureSeqRef = useRef(captureSeq)
  const onUpdateRef = useRef(onUpdate)
  // El editor pasa closures nuevas en cada render; el sondeo siempre llama a las últimas.
  useEffect(() => {
    captureSeqRef.current = captureSeq
    onUpdateRef.current = onUpdate
  })
  const kickRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let ctrl: AbortController | null = null
    // ¿Hace falta otra consulta? Arranca en true: la consulta del montaje.
    let want = true
    let lastLive = false
    let settle = false
    let errors = 0

    const clearTimer = () => {
      if (timer !== null) { clearTimeout(timer); timer = null }
    }
    const schedule = (ms: number) => {
      clearTimer()
      timer = setTimeout(() => { void run() }, ms)
    }

    async function run() {
      clearTimer()
      ctrl?.abort()
      ctrl = null
      // Pestaña oculta: no se consulta; `visibilitychange` la retoma al volver.
      if (disposed || document.visibilityState === 'hidden') return
      const mine = new AbortController()
      ctrl = mine
      const full = settle
      const since = full ? null : sinceRef.current
      const seq = captureSeqRef.current()
      try {
        // `encodeURIComponent` no es opcional: el `+00:00` de la marca de agua llegaría como espacio,
        // la ruta la descartaría por ilegible y devolvería la matriz entera en cada sondeo.
        const qs = since ? `?since=${encodeURIComponent(since)}` : ''
        const res = await fetch(`/api/matrices/${matrixId}/generation${qs}`, { cache: 'no-store', signal: mine.signal })
        if (res.status >= 400 && res.status < 500) {
          want = false
          settle = false
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as GenerationProgress
        if (disposed || mine.signal.aborted) return

        errors = 0
        if (full) settle = false
        if (body.items.length > 0 && body.watermark) sinceRef.current = body.watermark
        onUpdateRef.current(body, seq)

        const live = isGenerationLive(body)
        if (lastLive && !live) settle = true
        lastLive = live
        want = live
        setProgress(body)
        if (live) setObserved(true)
        if (live) schedule(POLL_MS)
        else if (settle) schedule(0)
      } catch {
        if (disposed || mine.signal.aborted) return
        errors += 1
        if (want || settle) schedule(Math.min(MAX_RETRY_MS, POLL_MS * 2 ** (errors - 1)))
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (want || settle) void run()
      } else {
        clearTimer()
        ctrl?.abort()
        ctrl = null
      }
    }

    kickRef.current = () => {
      want = true
      void run()
    }
    document.addEventListener('visibilitychange', onVisibility)
    void run()

    return () => {
      disposed = true
      clearTimer()
      ctrl?.abort()
      document.removeEventListener('visibilitychange', onVisibility)
      kickRef.current = () => {}
    }
  }, [matrixId, enabled])

  const kick = useCallback((hint?: GenerationKick) => {
    if (hint) {
      setProgress((p) => optimistic(p, hint))
      setObserved(true)
    }
    kickRef.current()
  }, [])

  return { progress, observed, kick }
}
