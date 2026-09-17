'use client'

import type { ContentType } from '@/types/db'
import { CONTENT_TYPE_LABELS, TIPPABLE_CONTENT_TYPES } from '@/lib/domain/plans'
import { CONTENT_ICONS } from '@/lib/domain/content-icons'
import { usageTone, type MatrixUsage, type UsageTone } from '@/lib/domain/matrix'

const TONE_CLASS: Record<UsageTone, string> = {
  neutral: 'border-fm-surface-container-high text-fm-on-surface bg-fm-surface-container-low',
  full: 'border-green-300 text-green-700 bg-green-50 dark:bg-green-500/15 dark:text-green-200 dark:border-green-400/40',
  over: 'border-red-300 text-red-700 bg-red-50 dark:bg-red-500/15 dark:text-red-200 dark:border-red-400/40',
}

interface Props {
  usage: MatrixUsage
  estimated: boolean
  /** Si se pasa, cada chip es un botón que agrega una pieza de ese tipo. */
  onAdd?: (type: ContentType) => void
  disabled?: boolean
}

/** `availableCredits`: créditos aún disponibles (se muestran). El tono ya viene calculado con los efectivos. */
function Chip({ tone, icon, label, used, limit, availableCredits, onClick, disabled }: {
  tone: UsageTone; icon: string; label: string; used: number; limit: number; availableCredits: number
  onClick?: () => void; disabled?: boolean
}) {
  const content = (
    <>
      <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{icon}</span>
      <span>{label}</span>
      <span className="tabular-nums font-bold">{used} / {limit}</span>
      {availableCredits > 0 && <span className="text-[10px] opacity-70">+{availableCredits} créd.</span>}
      {onClick && <span className="material-symbols-outlined text-[14px] opacity-60" aria-hidden="true">add</span>}
    </>
  )
  const cls = `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${TONE_CLASS[tone]}`
  if (!onClick) return <span className={cls}>{content}</span>
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={`Agregar ${label.toLowerCase()}`}
      className={`${cls} hover:brightness-95 disabled:opacity-50`}>
      {content}
    </button>
  )
}

export function MatrixChips({ usage, estimated, onAdd, disabled }: Props) {
  const poolTypes: ContentType[] = usage.pool ? TIPPABLE_CONTENT_TYPES : []
  const singles = usage.activeTypes.filter((t) => !poolTypes.includes(t))
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        {usage.pool && (
          <Chip tone={usageTone(usage.pool.used, usage.pool.limit, usage.pool.credits)} icon="stacks" label="Contenidos"
            used={usage.pool.used} limit={usage.pool.limit} availableCredits={usage.pool.availableCredits} />
        )}
        {singles.map((t) => {
          const u = usage.byType[t]
          return (
            <Chip key={t} tone={usageTone(u.used, u.limit, u.credits)} icon={CONTENT_ICONS[t]} label={CONTENT_TYPE_LABELS[t]}
              used={u.used} limit={u.limit} availableCredits={u.availableCredits}
              onClick={onAdd ? () => onAdd(t) : undefined} disabled={disabled} />
          )
        })}
        {usage.pool && onAdd && poolTypes.map((t) => (
          <button key={t} type="button" onClick={() => onAdd(t)} disabled={disabled} title={`Agregar ${CONTENT_TYPE_LABELS[t].toLowerCase()}`}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-fm-outline-variant px-2.5 py-1 text-[11px] text-fm-on-surface-variant hover:bg-fm-surface-container-low disabled:opacity-50">
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">{CONTENT_ICONS[t]}</span>+ {CONTENT_TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      {estimated && (
        <p className="text-[11px] text-fm-on-surface-variant">Cupos estimados según el plan actual: el ciclo objetivo aún no existe.</p>
      )}
    </div>
  )
}
