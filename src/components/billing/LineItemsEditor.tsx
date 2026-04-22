'use client'

import { Input } from '@/components/ui/input'
import { formatCurrency, type LineItemInput } from '@/lib/domain/invoices'

interface LineItemsEditorProps {
  items: LineItemInput[]
  onChange: (items: LineItemInput[]) => void
  disabled?: boolean
}

export function LineItemsEditor({ items, onChange, disabled }: LineItemsEditorProps) {
  function update(idx: number, patch: Partial<LineItemInput>) {
    const next = items.map((it, i) => (i === idx ? { ...it, ...patch } : it))
    onChange(next)
  }
  function remove(idx: number) {
    onChange(items.filter((_, i) => i !== idx))
  }
  function add() {
    onChange([...items, { description: '', quantity: 1, unit_price: 0 }])
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_70px_120px_120px_32px] gap-2 text-[10px] font-semibold text-fm-outline-variant uppercase tracking-wider px-1">
        <span>Descripción</span>
        <span className="text-right">Cant.</span>
        <span className="text-right">Precio unit.</span>
        <span className="text-right">Total línea</span>
        <span></span>
      </div>
      {items.map((it, idx) => {
        const line = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0)
        return (
          <div key={idx} className="grid grid-cols-[1fr_70px_120px_120px_32px] gap-2 items-center">
            <Input
              value={it.description}
              disabled={disabled}
              onChange={(e) => update(idx, { description: e.target.value })}
              placeholder="Concepto cobrado"
              className="rounded-lg bg-fm-background border-fm-surface-container-high h-9 text-sm"
            />
            <Input
              type="number" min={0} step="0.01"
              value={it.quantity}
              disabled={disabled}
              onChange={(e) => update(idx, { quantity: parseFloat(e.target.value) || 0 })}
              className="rounded-lg bg-fm-background border-fm-surface-container-high h-9 text-sm text-right"
            />
            <Input
              type="number" min={0} step="0.01"
              value={it.unit_price}
              disabled={disabled}
              onChange={(e) => update(idx, { unit_price: parseFloat(e.target.value) || 0 })}
              className="rounded-lg bg-fm-background border-fm-surface-container-high h-9 text-sm text-right"
            />
            <div className="h-9 flex items-center justify-end text-sm font-semibold text-fm-on-surface pr-2">
              {formatCurrency(line)}
            </div>
            <button
              type="button"
              onClick={() => remove(idx)}
              disabled={disabled}
              className="h-9 w-9 rounded-lg text-fm-error opacity-60 hover:opacity-100 hover:bg-fm-error/5 flex items-center justify-center"
              aria-label="Eliminar línea"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
            </button>
          </div>
        )
      })}
      <button
        type="button"
        onClick={add}
        disabled={disabled}
        className="w-full h-9 rounded-lg border border-dashed border-fm-primary/40 text-fm-primary text-sm font-semibold hover:bg-fm-primary/5"
      >
        + Agregar línea
      </button>
    </div>
  )
}
