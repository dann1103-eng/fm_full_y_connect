'use client'

import { useState, useTransition } from 'react'
import { createDevRequest } from '@/app/actions/devRequests'

export function DevRequestForm() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [compensation, setCompensation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    startTransition(async () => {
      const res = await createDevRequest({
        title,
        description,
        compensation_method: compensation,
      })
      if ('error' in res) {
        setError(res.error)
      } else {
        setSuccess(true)
        setTitle('')
        setDescription('')
        setCompensation('')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-fm-on-surface-variant mb-1.5">
          Título <span className="text-fm-error">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          required
          placeholder="Ej: Agregar filtro de fecha en el pipeline"
          className="w-full rounded-xl border border-fm-outline-variant/40 bg-fm-background px-3 py-2.5 text-sm text-fm-on-surface placeholder:text-fm-outline-variant focus:outline-none focus:border-fm-primary focus:ring-1 focus:ring-fm-primary/30"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-fm-on-surface-variant mb-1.5">
          Descripción <span className="text-fm-error">*</span>
        </label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          required
          rows={4}
          placeholder="Explica qué quieres cambiar y por qué sería útil…"
          className="w-full rounded-xl border border-fm-outline-variant/40 bg-fm-background px-3 py-2.5 text-sm text-fm-on-surface placeholder:text-fm-outline-variant focus:outline-none focus:border-fm-primary focus:ring-1 focus:ring-fm-primary/30 resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-fm-on-surface-variant mb-1.5">
          Método de retribución <span className="text-fm-error">*</span>
        </label>
        <input
          type="text"
          value={compensation}
          onChange={e => setCompensation(e.target.value)}
          required
          placeholder="Ej: Un café ☕, un almuerzo 🍔, gratitud eterna 🙏…"
          className="w-full rounded-xl border border-fm-outline-variant/40 bg-fm-background px-3 py-2.5 text-sm text-fm-on-surface placeholder:text-fm-outline-variant focus:outline-none focus:border-fm-primary focus:ring-1 focus:ring-fm-primary/30"
        />
        <p className="mt-1 text-[11px] text-fm-on-surface-variant">
          Sé honesto/a, esto lo ve el dev 👀
        </p>
      </div>

      {error && (
        <p className="text-sm text-fm-error bg-fm-error/5 border border-fm-error/20 rounded-xl px-3 py-2">
          {error}
        </p>
      )}

      {success && (
        <p className="text-sm text-fm-primary bg-fm-primary/5 border border-fm-primary/20 rounded-xl px-3 py-2">
          ✅ Solicitud enviada. ¡Ahora a esperar! 🧑‍💻
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full text-sm font-semibold text-white px-4 py-2.5 rounded-xl disabled:opacity-60 transition-opacity"
        style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
      >
        {isPending ? 'Enviando…' : 'Enviar solicitud 🚀'}
      </button>
    </form>
  )
}
