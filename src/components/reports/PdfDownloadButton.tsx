'use client'

import { useState } from 'react'

interface Props {
  clientId: string
}

export function PdfDownloadButton({ clientId }: Props) {
  const [includeDetail, setIncludeDetail] = useState(true)
  const [loading, setLoading] = useState(false)

  async function handleDownload() {
    setLoading(true)
    try {
      const url = `/api/reports/client/${clientId}?detail=${includeDetail}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Error generando PDF')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename="([^"]+)"/)
      a.download = match?.[1] ?? 'reporte.pdf'
      a.click()
      URL.revokeObjectURL(a.href)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-2 text-sm text-[#595c5e] cursor-pointer select-none">
        <input
          type="checkbox"
          checked={includeDetail}
          onChange={e => setIncludeDetail(e.target.checked)}
          className="w-4 h-4 accent-[#00675c] cursor-pointer"
        />
        Incluir detalle de requerimientos
      </label>
      <button
        onClick={handleDownload}
        disabled={loading}
        className="px-5 py-2.5 bg-[#00675c] text-white font-bold rounded-full hover:bg-[#005047] transition-all text-sm flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span className="material-symbols-outlined text-base">
          {loading ? 'hourglass_empty' : 'download'}
        </span>
        {loading ? 'Generando…' : 'Descargar PDF'}
      </button>
    </div>
  )
}
