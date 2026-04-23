'use client'

import { useState, useTransition } from 'react'
import { createClientUser, revokeClientUser } from '@/app/actions/clientUsers'

interface Props {
  clientId: string
  users: Array<{
    id: string
    user_id: string
    role: string
    users: { id: string; full_name: string | null; email: string | null; role: string } | null
  }>
}

export function ClientPortalInvite({ clientId, users }: Props) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (password.length < 8) {
      setMsg({ ok: false, text: 'La contraseña debe tener al menos 8 caracteres.' })
      return
    }
    startTransition(async () => {
      try {
        await createClientUser({ clientId, email, password, fullName: name || undefined })
        setEmail('')
        setName('')
        setPassword('')
        setMsg({
          ok: true,
          text: 'Credenciales creadas. Comparte el email y la contraseña con el cliente por WhatsApp o llamada.',
        })
      } catch (err) {
        setMsg({ ok: false, text: err instanceof Error ? err.message : 'Error al crear credenciales' })
      }
    })
  }

  function revoke(userId: string) {
    startTransition(async () => {
      try {
        await revokeClientUser({ clientId, userId })
        setMsg({ ok: true, text: 'Acceso revocado. El usuario fue eliminado.' })
      } catch (err) {
        setMsg({ ok: false, text: err instanceof Error ? err.message : 'Error al revocar' })
      }
    })
  }

  return (
    <section className="glass-panel p-5">
      <h3 className="text-base font-semibold text-fm-on-surface mb-1">Portal del cliente</h3>
      <p className="text-sm text-fm-on-surface-variant mb-4">
        Crea credenciales directas para que el cliente acceda con email y contraseña.
      </p>

      <form onSubmit={create} className="space-y-2 mb-4">
        <div className="flex flex-col md:flex-row gap-2">
          <input
            type="email"
            required
            placeholder="email@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded-lg border border-fm-outline-variant/40 px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Nombre (opcional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-lg border border-fm-outline-variant/40 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col md:flex-row gap-2">
          <input
            type="password"
            required
            minLength={8}
            placeholder="Contraseña (mín. 8 caracteres)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="flex-1 rounded-lg border border-fm-outline-variant/40 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-fm-primary text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isPending ? 'Creando…' : 'Crear credenciales'}
          </button>
        </div>
      </form>

      {msg && (
        <p className={`text-sm mb-3 ${msg.ok ? 'text-fm-primary' : 'text-fm-error'}`}>{msg.text}</p>
      )}

      <div className="space-y-1.5">
        {users.length === 0 && (
          <p className="text-sm text-fm-outline-variant">Aún no hay contactos con acceso al portal.</p>
        )}
        {users.map((link) => (
          <div
            key={link.id}
            className="flex items-center justify-between rounded-lg border border-fm-outline-variant/30 px-3 py-2"
          >
            <div className="text-sm">
              <p className="font-medium text-fm-on-surface">
                {link.users?.full_name ?? link.users?.email ?? '(sin nombre)'}
              </p>
              <p className="text-xs text-fm-on-surface-variant">{link.users?.email}</p>
            </div>
            <button
              onClick={() => revoke(link.user_id)}
              disabled={isPending}
              className="text-sm text-fm-error hover:underline disabled:opacity-50"
            >
              Revocar
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
