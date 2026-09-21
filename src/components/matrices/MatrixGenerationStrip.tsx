'use client'

import { generationReasonLabel, type GenerationProgress } from '@/lib/domain/matrix-generation'

interface Props {
  progress: GenerationProgress | null
  /** Esta pestaña lanzó la generación o la vio viva: solo entonces se cuenta cómo terminó. */
  observed: boolean
  /** Matriz en borrador: el fallo del último padre solo se muestra ahí (en una aprobada ya no se genera). */
  draft: boolean
  /** El plan usa pool unificado: la IA no genera historias. */
  pool: boolean
  dismissed: boolean
  onDismiss: () => void
}

type Tone = 'info' | 'warn' | 'error'

const TONE_CLASS: Record<Tone, string> = {
  info: 'border-fm-primary/30 bg-fm-primary/5 text-fm-on-surface',
  warn: 'border-amber-300/60 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200',
  error: 'border-fm-error/30 bg-fm-error/5 text-fm-error',
}

const POOL_NOTE = 'El plan usa pool unificado: no se generan historias.'
/** El `error_text` de un job puede ser largo (una traza del SDK): la franja muestra el principio. */
const ERROR_MAX = 240

/**
 * Franja de la generación con IA (bloque 3). En curso: "Planificando…" y "Generando… 7 de 15". Al
 * terminar (solo si esta pestaña la vio): el resumen, o el motivo cuando el padre no creó nada — terminar
 * en silencio con 0 piezas parecería éxito. Un padre fallido se muestra en rojo.
 *
 * `phase: 'writing'` con `total: 0` es una regeneración suelta: de eso se encarga la fila ("Redactando…"),
 * aquí nunca sale un "0 de 0".
 */
export function MatrixGenerationStrip({ progress: p, observed, draft, pool, dismissed, onDismiss }: Props) {
  if (!p) return null

  const ownFinished = p.done + p.failed >= p.total
  const planning = p.phase === 'planning'
  const writing = !planning && p.phase !== 'failed' && p.total > 0 && !ownFinished

  if (planning || writing) {
    const pct = p.total > 0 ? Math.round(((p.done + p.failed) / p.total) * 100) : 0
    return (
      <div role="status" className={`rounded-xl border px-3 py-2 text-xs space-y-1.5 ${TONE_CLASS.info}`}>
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-fm-primary animate-spin" aria-hidden="true">progress_activity</span>
          <span className="font-semibold">
            {planning ? 'Planificando la matriz con IA…' : `Generando… ${p.done} de ${p.total}`}
          </span>
          {writing && p.failed > 0 && (
            <span className="text-fm-error">· {p.failed} sin redactar</span>
          )}
        </div>
        {writing && (
          <div className="h-1.5 rounded-full bg-fm-surface-container-high overflow-hidden" aria-hidden="true">
            <div className="h-full bg-fm-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
        )}
        <p className="text-[11px] text-fm-on-surface-variant">
          Puedes seguir editando o cerrar la pestaña: la generación sigue en el servidor.{pool ? ` ${POOL_NOTE}` : ''}
        </p>
      </div>
    )
  }

  if (dismissed) return null

  let tone: Tone | null = null
  let message: string | null = null
  if (p.phase === 'failed') {
    if (draft) {
      tone = 'error'
      const detail = p.error ? ` ${p.error.length > ERROR_MAX ? `${p.error.slice(0, ERROR_MAX - 1)}…` : p.error}` : ''
      message = `La última generación con IA falló. Puedes intentarlo de nuevo.${detail}`
    }
  } else if (observed && ownFinished) {
    if (p.total > 0) {
      tone = p.failed > 0 ? 'warn' : 'info'
      message = p.failed > 0
        ? `Generación terminada: ${p.done} de ${p.total} piezas redactadas. ${p.failed} quedaron sin redactar: usa «Regenerar» en cada una.`
        : `Generación terminada: ${p.done} pieza${p.done !== 1 ? 's' : ''} redactada${p.done !== 1 ? 's' : ''}. Revísalas antes de aprobar.`
    } else if (p.reason) {
      tone = 'warn'
      message = generationReasonLabel(p.reason)
    }
  }
  if (!tone || !message) return null

  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${TONE_CLASS[tone]}`}>
      <p role={tone === 'error' ? 'alert' : 'status'} className="flex-1 min-w-0">{message}</p>
      <button type="button" onClick={onDismiss} aria-label="Ocultar aviso de la generación"
        className="material-symbols-outlined text-[16px] rounded-md p-0.5 opacity-70 hover:opacity-100">close</button>
    </div>
  )
}
