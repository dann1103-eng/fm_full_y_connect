'use client'

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="px-5 py-2.5 border-2 border-[#2c2f31] text-[#2c2f31] font-bold rounded-full hover:bg-[#2c2f31]/5 transition-all text-sm flex items-center gap-2"
    >
      <span className="material-symbols-outlined text-base">print</span>
      Descargar PDF
    </button>
  )
}
