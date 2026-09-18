'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { MATRIX_OBJECTIVE_LABELS } from '@/lib/domain/matrix'
import type { MatrixObjective } from '@/types/db'

interface Props {
  requirementId: string
}

type BriefRow = {
  id: string
  matrix_id: string
  topic: string | null
  objective: MatrixObjective | null
  copy: string | null
  script: string | null
  visual_style: string | null
  hashtags: string | null
  cta: string | null
  matrix: { id: string; title: string } | null
}

/**
 * "Brief de la matriz": lee en vivo la pieza de `content_matrix_items` vinculada al
 * requerimiento. La RLS de esa tabla es de admin/supervisor, así que para un operador
 * la query devuelve 0 filas (no error) y la sección simplemente no se renderiza.
 * El portal del cliente no monta este componente.
 */
export function MatrixBriefSection({ requirementId }: Props) {
  const [brief, setBrief] = useState<BriefRow | null>(null)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    supabase
      .from('content_matrix_items')
      .select('id, matrix_id, topic, objective, copy, script, visual_style, hashtags, cta, matrix:content_matrices!inner(id, title)')
      .eq('requirement_id', requirementId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          // Sin brief visible (RLS o fallo puntual): no rompemos la ficha.
          console.error('No se pudo cargar el brief de la matriz', error)
          setBrief(null)
          return
        }
        setBrief((data as unknown as BriefRow | null) ?? null)
      })

    return () => {
      cancelled = true
    }
  }, [requirementId])

  if (!brief) return null

  const fields: Array<{ label: string; value: string; pre?: boolean }> = []
  if (brief.topic?.trim()) fields.push({ label: 'Tema', value: brief.topic })
  if (brief.objective) fields.push({ label: 'Objetivo', value: MATRIX_OBJECTIVE_LABELS[brief.objective] ?? brief.objective })
  if (brief.copy?.trim()) fields.push({ label: 'Copy', value: brief.copy, pre: true })
  if (brief.script?.trim()) fields.push({ label: 'Guion', value: brief.script, pre: true })
  if (brief.visual_style?.trim()) fields.push({ label: 'Estilo visual', value: brief.visual_style, pre: true })
  if (brief.hashtags?.trim()) fields.push({ label: 'Hashtags', value: brief.hashtags, pre: true })
  if (brief.cta?.trim()) fields.push({ label: 'Llamado a la acción', value: brief.cta, pre: true })

  return (
    <div className="space-y-3 pb-4 border-b border-fm-surface-container-low">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold text-fm-outline-variant uppercase tracking-wider flex items-center gap-1.5">
          <span className="material-symbols-outlined text-fm-primary text-[14px]">grid_view</span>
          Brief de la matriz
        </p>
        <Link
          href={`/matrices/${brief.matrix_id}`}
          className="text-[11px] font-semibold text-fm-primary hover:underline truncate max-w-[55%] text-right"
        >
          {brief.matrix?.title || 'Ver matriz'}
        </Link>
      </div>

      <div className="rounded-xl bg-fm-background border border-fm-surface-container-high px-3 py-2.5 space-y-2">
        {fields.length === 0 && (
          <p className="text-xs text-fm-outline-variant">La pieza no tiene brief cargado.</p>
        )}
        {fields.map((f) => (
          <div key={f.label} className="space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-fm-on-surface-variant">{f.label}</p>
            {/* Los campos largos se acotan: un guion de 10 000 caracteres empujaría fuera de la
                ficha el historial de fases. */}
            <p
              className={`text-sm text-fm-on-surface break-words ${
                f.pre ? 'whitespace-pre-wrap max-h-48 overflow-y-auto' : ''
              }`}
            >
              {f.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
