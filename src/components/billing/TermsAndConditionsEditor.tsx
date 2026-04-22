'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  upsertTermAndCondition,
  deleteTermAndCondition,
  reorderTermsAndConditions,
} from '@/app/actions/company-settings'
import type { TermAndCondition } from '@/types/db'

interface TermsAndConditionsEditorProps {
  initialTerms: TermAndCondition[]
}

export function TermsAndConditionsEditor({ initialTerms }: TermsAndConditionsEditorProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [terms, setTerms] = useState(() => [...initialTerms].sort((a, b) => a.order - b.order))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftText, setDraftText] = useState('')
  const [newText, setNewText] = useState('')
  const [error, setError] = useState<string | null>(null)

  function startEdit(term: TermAndCondition) {
    setEditingId(term.id)
    setDraftText(term.text)
    setError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setDraftText('')
  }

  function saveEdit(term: TermAndCondition) {
    if (!draftText.trim()) { setError('El texto no puede estar vacío'); return }
    startTransition(async () => {
      const result = await upsertTermAndCondition({ id: term.id, order: term.order, text: draftText.trim() })
      if ('error' in result) { setError(result.error); return }
      setTerms(prev => prev.map(t => t.id === term.id ? { ...t, text: draftText.trim() } : t))
      setEditingId(null)
      setDraftText('')
      router.refresh()
    })
  }

  function addNew() {
    if (!newText.trim()) { setError('El texto no puede estar vacío'); return }
    const order = terms.length ? Math.max(...terms.map(t => t.order)) + 1 : 1
    startTransition(async () => {
      const result = await upsertTermAndCondition({ order, text: newText.trim() })
      if ('error' in result) { setError(result.error); return }
      setTerms(prev => [...prev, { id: result.id!, order, text: newText.trim() }])
      setNewText('')
      router.refresh()
    })
  }

  function removeTerm(termId: string) {
    if (!confirm('¿Eliminar este término?')) return
    startTransition(async () => {
      const result = await deleteTermAndCondition(termId)
      if ('error' in result) { setError(result.error); return }
      setTerms(prev => prev.filter(t => t.id !== termId))
      router.refresh()
    })
  }

  function move(idx: number, direction: -1 | 1) {
    const newIdx = idx + direction
    if (newIdx < 0 || newIdx >= terms.length) return
    const next = [...terms]
    ;[next[idx], next[newIdx]] = [next[newIdx], next[idx]]
    const withOrder = next.map((t, i) => ({ ...t, order: i + 1 }))
    setTerms(withOrder)
    startTransition(async () => {
      const result = await reorderTermsAndConditions(withOrder.map(t => t.id))
      if ('error' in result) { setError(result.error); return }
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-sm text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">
          {error}
        </p>
      )}

      <ol className="space-y-2">
        {terms.map((term, idx) => (
          <li key={term.id} className="bg-fm-background border border-fm-surface-container-high rounded-xl p-3 flex gap-3">
            <div className="flex flex-col items-center gap-1 pt-1">
              <button
                type="button"
                onClick={() => move(idx, -1)}
                disabled={idx === 0 || isPending}
                className="text-fm-outline hover:text-fm-primary disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Mover arriba"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>keyboard_arrow_up</span>
              </button>
              <span className="text-xs font-semibold text-fm-on-surface-variant w-6 text-center">{idx + 1}</span>
              <button
                type="button"
                onClick={() => move(idx, 1)}
                disabled={idx === terms.length - 1 || isPending}
                className="text-fm-outline hover:text-fm-primary disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Mover abajo"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>keyboard_arrow_down</span>
              </button>
            </div>

            <div className="flex-1 min-w-0">
              {editingId === term.id ? (
                <div className="space-y-2">
                  <Textarea
                    rows={3}
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    className="rounded-lg bg-fm-surface-container-lowest border-fm-surface-container-high resize-none"
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={() => saveEdit(term)}
                      disabled={isPending}
                      className="rounded-lg text-white text-xs"
                      style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
                    >
                      Guardar
                    </Button>
                    <Button type="button" variant="outline" onClick={cancelEdit} disabled={isPending} className="rounded-lg text-xs">
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-fm-on-surface whitespace-pre-wrap">{term.text}</p>
              )}
            </div>

            {editingId !== term.id && (
              <div className="flex items-start gap-1">
                <button
                  type="button"
                  onClick={() => startEdit(term)}
                  disabled={isPending}
                  className="h-8 w-8 rounded-lg text-fm-outline hover:text-fm-primary hover:bg-fm-primary/5 flex items-center justify-center"
                  aria-label="Editar"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>edit</span>
                </button>
                <button
                  type="button"
                  onClick={() => removeTerm(term.id)}
                  disabled={isPending}
                  className="h-8 w-8 rounded-lg text-fm-error opacity-60 hover:opacity-100 hover:bg-fm-error/5 flex items-center justify-center"
                  aria-label="Eliminar"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="bg-fm-surface-container-lowest border border-dashed border-fm-primary/40 rounded-xl p-3 space-y-2">
        <Textarea
          rows={2}
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Nuevo término o condición…"
          className="rounded-lg bg-fm-background border-fm-surface-container-high resize-none"
        />
        <Button
          onClick={addNew}
          disabled={isPending || !newText.trim()}
          className="rounded-lg text-white text-sm"
          style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
        >
          + Agregar término
        </Button>
      </div>
    </div>
  )
}
