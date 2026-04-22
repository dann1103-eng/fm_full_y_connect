'use client'

import Link from 'next/link'

interface RequirementShareCardProps {
  requirementId: string
  title: string
  isMine?: boolean
}

export function parseReqShareBody(body: string): { requirementId: string; title: string } | null {
  if (!body.startsWith('<<<req-share:')) return null
  const m = body.match(/^<<<req-share:([^:]+):(.+)>>>$/)
  if (!m) return null
  return { requirementId: m[1], title: m[2].trim() }
}

export function RequirementShareCard({ requirementId, title, isMine }: RequirementShareCardProps) {
  return (
    <div
      className={
        'mt-1 flex items-center gap-3 rounded-lg border px-3 py-2.5 max-w-md ' +
        (isMine
          ? 'bg-fm-surface-container-lowest/90 border-white/50 text-fm-on-surface'
          : 'bg-fm-surface-container-lowest border-fm-surface-container-high text-fm-on-surface')
      }
    >
      <div className="w-9 h-9 rounded-lg bg-fm-primary/10 flex items-center justify-center flex-shrink-0">
        <span className="material-symbols-outlined text-fm-primary text-[20px]">assignment</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-fm-on-surface-variant/80">
          Requerimiento compartido
        </div>
        <div className="text-sm font-semibold truncate">{title}</div>
      </div>
      <Link
        href={`/pipeline?req=${requirementId}`}
        className="text-xs font-bold text-fm-primary hover:underline flex-shrink-0"
      >
        Abrir
      </Link>
    </div>
  )
}
