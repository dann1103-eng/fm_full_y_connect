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
          ? 'bg-white/90 border-white/50 text-[#2c2f31]'
          : 'bg-white border-[#dfe3e6] text-[#2c2f31]')
      }
    >
      <div className="w-9 h-9 rounded-lg bg-[#00675c]/10 flex items-center justify-center flex-shrink-0">
        <span className="material-symbols-outlined text-[#00675c] text-[20px]">assignment</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[#595c5e]/80">
          Requerimiento compartido
        </div>
        <div className="text-sm font-semibold truncate">{title}</div>
      </div>
      <Link
        href={`/pipeline?req=${requirementId}`}
        className="text-xs font-bold text-[#00675c] hover:underline flex-shrink-0"
      >
        Abrir
      </Link>
    </div>
  )
}
