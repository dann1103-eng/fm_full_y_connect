'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { upsertPaymentMethod, deletePaymentMethod } from '@/app/actions/company-settings'
import type { PaymentMethodConfig } from '@/types/db'

interface PaymentMethodsEditorProps {
  initialMethods: PaymentMethodConfig[]
}

type Draft = Partial<PaymentMethodConfig> & { type: PaymentMethodConfig['type']; label: string }

const EMPTY_DRAFT: Draft = { type: 'bank', label: '' }

export function PaymentMethodsEditor({ initialMethods }: PaymentMethodsEditorProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [methods, setMethods] = useState(initialMethods)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startEdit(m: PaymentMethodConfig) {
    setEditingId(m.id)
    setDraft({ ...m })
    setShowNew(false)
    setError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setShowNew(false)
    setDraft(EMPTY_DRAFT)
    setError(null)
  }

  function save() {
    if (!draft.label?.trim()) { setError('La etiqueta es obligatoria'); return }
    if (draft.type === 'bank' && !draft.account_number?.trim()) { setError('El número de cuenta es obligatorio'); return }

    const payload: PaymentMethodConfig = {
      id: draft.id ?? '',
      type: draft.type,
      label: draft.label.trim(),
      account_holder: draft.account_holder?.trim() || undefined,
      account_number: draft.account_number?.trim() || undefined,
      account_type: draft.account_type?.trim() || undefined,
      note: draft.note?.trim() || undefined,
    }

    startTransition(async () => {
      const result = await upsertPaymentMethod(payload)
      if ('error' in result) { setError(result.error); return }
      const savedId = result.id!
      setMethods(prev => {
        const exists = prev.some(m => m.id === savedId)
        const saved = { ...payload, id: savedId }
        return exists ? prev.map(m => m.id === savedId ? saved : m) : [...prev, saved]
      })
      cancelEdit()
      router.refresh()
    })
  }

  function remove(id: string) {
    if (!confirm('¿Eliminar este método de pago?')) return
    startTransition(async () => {
      const result = await deletePaymentMethod(id)
      if ('error' in result) { setError(result.error); return }
      setMethods(prev => prev.filter(m => m.id !== id))
      router.refresh()
    })
  }

  function renderForm() {
    return (
      <div className="bg-fm-background border border-fm-primary/30 rounded-xl p-4 space-y-3">
        <div className="space-y-1.5">
          <Label>Tipo</Label>
          <select
            value={draft.type}
            onChange={(e) => setDraft(d => ({ ...d, type: e.target.value as PaymentMethodConfig['type'] }))}
            className="w-full py-2 px-3 text-sm bg-fm-surface-container-lowest border border-fm-surface-container-high rounded-xl text-fm-on-surface focus:outline-none focus:border-fm-primary"
          >
            <option value="bank">Banco / Transferencia</option>
            <option value="card">Tarjeta</option>
            <option value="other">Otro</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <Label>Etiqueta</Label>
          <Input
            value={draft.label}
            onChange={(e) => setDraft(d => ({ ...d, label: e.target.value }))}
            placeholder={draft.type === 'bank' ? 'Banco BAC' : 'Tarjeta de crédito/débito'}
            className="rounded-xl bg-fm-surface-container-lowest border-fm-surface-container-high"
          />
        </div>

        {draft.type === 'bank' && (
          <>
            <div className="space-y-1.5">
              <Label>Titular de la cuenta</Label>
              <Input
                value={draft.account_holder ?? ''}
                onChange={(e) => setDraft(d => ({ ...d, account_holder: e.target.value }))}
                placeholder="Laura María Morataya de Flores"
                className="rounded-xl bg-fm-surface-container-lowest border-fm-surface-container-high"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Número de cuenta</Label>
                <Input
                  value={draft.account_number ?? ''}
                  onChange={(e) => setDraft(d => ({ ...d, account_number: e.target.value }))}
                  placeholder="116244039"
                  className="rounded-xl bg-fm-surface-container-lowest border-fm-surface-container-high"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Tipo de cuenta</Label>
                <Input
                  value={draft.account_type ?? ''}
                  onChange={(e) => setDraft(d => ({ ...d, account_type: e.target.value }))}
                  placeholder="Cuenta corriente"
                  className="rounded-xl bg-fm-surface-container-lowest border-fm-surface-container-high"
                />
              </div>
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <Label>Nota (opcional)</Label>
          <Textarea
            rows={2}
            value={draft.note ?? ''}
            onChange={(e) => setDraft(d => ({ ...d, note: e.target.value }))}
            placeholder="Información adicional para el cliente…"
            className="rounded-xl bg-fm-surface-container-lowest border-fm-surface-container-high resize-none"
          />
        </div>

        {error && (
          <p className="text-sm text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button
            onClick={save}
            disabled={isPending}
            className="rounded-lg text-white text-sm"
            style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
          >
            Guardar
          </Button>
          <Button type="button" variant="outline" onClick={cancelEdit} disabled={isPending} className="rounded-lg text-sm">
            Cancelar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {methods.map(m => (
          <li key={m.id}>
            {editingId === m.id ? renderForm() : (
              <div className="bg-fm-background border border-fm-surface-container-high rounded-xl p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-fm-primary bg-fm-primary/10 px-2 py-0.5 rounded-full">
                      {m.type === 'bank' ? 'Banco' : m.type === 'card' ? 'Tarjeta' : 'Otro'}
                    </span>
                    <p className="text-sm font-semibold text-fm-on-surface">{m.label}</p>
                  </div>
                  {m.type === 'bank' && (
                    <div className="text-xs text-fm-on-surface-variant mt-1 space-y-0.5">
                      {m.account_holder && <p>Titular: {m.account_holder}</p>}
                      {m.account_number && <p>Cuenta: {m.account_number} {m.account_type ? `(${m.account_type})` : ''}</p>}
                    </div>
                  )}
                  {m.note && <p className="text-xs text-fm-on-surface-variant mt-1">{m.note}</p>}
                </div>
                <div className="flex items-start gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(m)}
                    disabled={isPending}
                    className="h-8 w-8 rounded-lg text-fm-outline hover:text-fm-primary hover:bg-fm-primary/5 flex items-center justify-center"
                    aria-label="Editar"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(m.id)}
                    disabled={isPending}
                    className="h-8 w-8 rounded-lg text-fm-error opacity-60 hover:opacity-100 hover:bg-fm-error/5 flex items-center justify-center"
                    aria-label="Eliminar"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {showNew ? renderForm() : (
        <Button
          type="button"
          onClick={() => { setShowNew(true); setDraft(EMPTY_DRAFT); setEditingId(null); setError(null) }}
          variant="outline"
          className="w-full rounded-xl border-dashed border-fm-primary/40 text-fm-primary hover:bg-fm-primary/5"
        >
          + Agregar método de pago
        </Button>
      )}
    </div>
  )
}
