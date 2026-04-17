'use client'

interface CsvDownloadButtonProps {
  rows: string[][]
  headers: string[]
  filename: string
  label?: string
}

export function CsvDownloadButton({
  rows,
  headers,
  filename,
  label = 'Descargar CSV',
}: CsvDownloadButtonProps) {
  function handleDownload() {
    const allRows = [headers, ...rows]
    const csvContent = allRows
      .map((row) =>
        row.map((cell) => {
          // Escape cells containing commas, quotes, or newlines
          const escaped = cell.replace(/"/g, '""')
          return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped
        }).join(',')
      )
      .join('\r\n')

    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', filename)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  }

  return (
    <button
      onClick={handleDownload}
      className="px-5 py-2.5 border-2 border-[#00675c] text-[#00675c] font-bold rounded-full hover:bg-[#00675c]/5 transition-all text-sm flex items-center gap-2"
    >
      <span className="material-symbols-outlined text-base">download</span>
      {label}
    </button>
  )
}
