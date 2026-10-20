import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import type { ContentType } from '@/types/db'
import { PoolCreditsAdjust } from './PoolCreditsAdjust'

interface Props {
  clientId: string
  cambios: number
  content: Partial<Record<ContentType, number>>
  /** Saldo del paquete on-demand (cubre cualquier tipo tippable). */
  pool: number
  /** Solo admin: puede agregar o quitar saldo del paquete a mano. */
  canAdjust?: boolean
}

export function ClientCreditsCard({ clientId, cambios, content, pool, canAdjust = false }: Props) {
  const contentEntries = Object.entries(content).filter(([, qty]) => (qty ?? 0) > 0) as [ContentType, number][]
  const total = cambios + pool + contentEntries.reduce((s, [, q]) => s + q, 0)

  if (total === 0) {
    // Sin créditos: solo el admin ve un acceso discreto para agregar el primer paquete.
    if (!canAdjust) return null
    return (
      <section className="glass-panel rounded-2xl px-5 py-3 flex items-center gap-2">
        <span className="material-symbols-outlined text-fm-primary text-xl">redeem</span>
        <span className="text-sm text-fm-on-surface-variant">Sin créditos ni paquete on-demand.</span>
        <span className="ml-auto"><PoolCreditsAdjust clientId={clientId} remaining={0} /></span>
      </section>
    )
  }

  return (
    <section className="glass-panel rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-fm-primary text-xl">redeem</span>
        <h2 className="text-base font-semibold text-fm-on-surface">Créditos disponibles</h2>
        <span className="text-xs text-fm-on-surface-variant ml-1">— sin caducidad, se usan hasta agotarse</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {pool > 0 && (
          <div className="rounded-xl bg-fm-primary/10 border border-fm-primary/30 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fm-primary">Paquete on-demand</p>
            <p className="text-2xl font-bold text-fm-on-surface mt-1">{pool}</p>
            <p className="text-[10px] text-fm-on-surface-variant mt-0.5">Cualquier tipo, al agotar el cupo del mes</p>
          </div>
        )}
        {cambios > 0 && (
          <div className="rounded-xl bg-fm-primary/5 border border-fm-primary/20 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fm-primary">Cambios extra</p>
            <p className="text-2xl font-bold text-fm-on-surface mt-1">{cambios}</p>
          </div>
        )}
        {contentEntries.map(([type, qty]) => (
          <div key={type} className="rounded-xl bg-fm-surface-container-low border border-fm-surface-container-high p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fm-on-surface-variant">
              {CONTENT_TYPE_LABELS[type]}
            </p>
            <p className="text-2xl font-bold text-fm-on-surface mt-1">{qty}</p>
          </div>
        ))}
      </div>
      {canAdjust && (
        <div className="mt-3">
          <PoolCreditsAdjust clientId={clientId} remaining={pool} />
        </div>
      )}
    </section>
  )
}
