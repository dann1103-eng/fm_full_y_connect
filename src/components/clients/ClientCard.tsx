import Link from 'next/link'
import type { ClientDashboardItem } from '@/app/(app)/dashboard/page'
import type { ContentType } from '@/types/db'
import { CONTENT_TYPES, unifiedPoolUsage } from '@/lib/domain/plans'
import { CONTENT_ICONS } from '@/lib/domain/content-icons'

const STATUS_LABELS: Record<string, string> = {
  active: 'Activo',
  paused: 'Pausado',
  overdue: 'Moroso',
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-fm-primary/10 text-fm-primary border-fm-primary/20',
  paused: 'bg-fm-on-surface-variant/10 text-fm-on-surface-variant border-fm-on-surface-variant/20',
  overdue: 'bg-fm-error/10 text-fm-error border-fm-error/20',
}

// Producción y reunión son eventos esporádicos; no cuentan para el progreso
// del flujo de contenido ni se muestran como íconos en la card del dashboard.
const EXCLUDED_FROM_CARD = new Set<ContentType>(['produccion', 'reunion'])

// Amber-toned types share a different accent color from the rest
const AMBER_TYPES = new Set(['estatico', 'video_corto'])

function progressColor(consumed: number, limit: number): string {
  if (limit === 0) return 'bg-fm-outline-variant'
  const pct = (consumed / limit) * 100
  if (pct >= 90) return 'bg-fm-error'
  if (pct >= 70) return 'bg-amber-400'
  return 'bg-fm-primary'
}

function overallProgress(
  totals: Record<string, number>,
  limits: Record<string, number>
): number {
  let totalConsumed = 0
  let totalLimit = 0
  for (const type of CONTENT_TYPES) {
    if (EXCLUDED_FROM_CARD.has(type)) continue
    totalConsumed += totals[type] ?? 0
    totalLimit += limits[type] ?? 0
  }
  if (totalLimit === 0) return 0
  return Math.min(100, Math.round((totalConsumed / totalLimit) * 100))
}

function getAvatarText(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

const avatarGradients = [
  'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)',
  'linear-gradient(135deg, #4a6319 0%, #ceee93 100%)',
  'linear-gradient(135deg, #006385 0%, #1dc0fe 100%)',
  'linear-gradient(135deg, #5c4a8a 0%, #b89cff 100%)',
  'linear-gradient(135deg, #7a4f00 0%, #ffcc5c 100%)',
]

function clientGradient(name: string): string {
  const idx = name.charCodeAt(0) % avatarGradients.length
  return avatarGradients[idx]
}

export function ClientCard({ item }: { item: ClientDashboardItem }) {
  const { client, cycle, totals, limits, daysLeft, isContentPackage } = item
  const unifiedPool =
    isContentPackage && cycle ? unifiedPoolUsage(cycle.limits_snapshot_json, totals) : null
  const pct = unifiedPool
    ? unifiedPool.limit > 0
      ? Math.min(100, Math.round((unifiedPool.used / unifiedPool.limit) * 100))
      : 0
    : overallProgress(totals, limits)
  const barColor =
    pct >= 90 ? 'bg-fm-error' : pct >= 70 ? 'bg-amber-400' : 'bg-fm-primary'

  // Mini-counters per type only for non-unified plans.
  const visibleTypes = isContentPackage
    ? []
    : CONTENT_TYPES.filter((t) => !EXCLUDED_FROM_CARD.has(t) && (limits[t] ?? 0) > 0)

  return (
    <Link
      href={`/clients/${client.id}`}
      className="block bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 hover:border-fm-primary/40 hover:shadow-md transition-all duration-200 overflow-hidden group"
    >
      {/* Card header */}
      <div className="p-4 sm:p-5 pb-3">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            {client.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={client.logo_url}
                alt={client.name}
                className="w-10 h-10 rounded-xl object-cover flex-shrink-0"
              />
            ) : (
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white font-bold text-sm"
                style={{ background: clientGradient(client.name) }}
              >
                {getAvatarText(client.name)}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-semibold text-fm-on-surface truncate group-hover:text-fm-primary transition-colors">
                {client.name}
              </p>
              <p className="text-xs text-fm-on-surface-variant">{client.plan.name}</p>
            </div>
          </div>
          <span
            className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full border ${STATUS_COLORS[client.status]}`}
          >
            {STATUS_LABELS[client.status]}
          </span>
        </div>

        {/* Overall progress */}
        {cycle && (
          <>
            <div className="flex items-center justify-between text-xs text-fm-on-surface-variant mb-1.5">
              <span>
                {unifiedPool ? 'Paquete de contenido' : 'Requerimientos del ciclo'}
              </span>
              <span className="font-semibold text-fm-on-surface">
                {unifiedPool ? `${unifiedPool.used}/${unifiedPool.limit} · ${pct}%` : `${pct}%`}
              </span>
            </div>
            <div className="w-full h-1.5 bg-fm-surface-container-low dark:bg-white/15 rounded-full overflow-hidden mb-3">
              <div
                className={`h-full rounded-full transition-all ${barColor}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        )}
      </div>

      {/* Content type mini-counters */}
      {visibleTypes.length > 0 && (
        <div className="px-4 sm:px-5 pb-3 grid grid-cols-3 gap-2">
          {visibleTypes.map((type) => {
            const consumed = totals[type] ?? 0
            const limit = limits[type] ?? 0
            const col = progressColor(consumed, limit)
            const isAmber = AMBER_TYPES.has(type)
            const iconColor = isAmber ? '#d97706' : '#00675c'
            return (
              <div key={type} className="flex flex-col items-center gap-1">
                <span
                  className="material-symbols-outlined text-[18px]"
                  style={{ color: iconColor }}
                >
                  {CONTENT_ICONS[type]}
                </span>
                <span className="text-xs font-medium text-fm-on-surface">
                  {consumed}/{limit}
                </span>
                <div className="w-full h-1 bg-fm-surface-container-low dark:bg-white/15 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${col}`}
                    style={{ width: `${limit > 0 ? Math.min(100, (consumed / limit) * 100) : 0}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 sm:px-5 py-3 bg-fm-background border-t border-fm-outline-variant/10 flex items-center justify-between">
        {isContentPackage ? (
          <span className="text-xs text-fm-on-surface-variant">Paquete activo · sin vencimiento</span>
        ) : daysLeft !== null ? (
          <span
            className={`text-xs font-medium ${daysLeft <= 3 ? 'text-fm-error' : daysLeft <= 7 ? 'text-amber-600' : 'text-fm-on-surface-variant'}`}
          >
            {daysLeft < 0
              ? 'Ciclo vencido'
              : daysLeft === 0
              ? 'Vence hoy'
              : `${daysLeft} día${daysLeft !== 1 ? 's' : ''} restante${daysLeft !== 1 ? 's' : ''}`}
          </span>
        ) : (
          <span className="text-xs text-fm-on-surface-variant">Sin ciclo activo</span>
        )}
        <span className="text-xs text-fm-outline group-hover:text-fm-primary transition-colors flex items-center gap-1">
          Ver ficha
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
          </svg>
        </span>
      </div>
    </Link>
  )
}
