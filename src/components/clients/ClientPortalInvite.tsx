'use client'

import { useState, useTransition } from 'react'
import { inviteClientUser, revokeClientUser } from '@/app/actions/clientUsers'

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
  const [msg, setMsg] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    startTransition(async () => {
      try {
        await inviteClientUser({ clientId, email, fullName: name || undefined })
        setEmail('')
        setName('')
        setMsg('Invitación enviada')
      } catch (err) {
        setMsg(err instanceof Error ? err.message : 'Error al invitar')
      }
    })
  }

  function revoke(userId: string) {
    startTransition(async () => {
      try {
        await revokeClientUser({ clientId, userId })
      } catch (err) {
        setMsg(err instanceof Error ? err.message : 'Error al revocar')
      }
    })
  }

  return (
    <section className="glass-panel p-5">
      <h3 className="text-base font-semibold text-fm-on-surface mb-1">Portal del cliente</h3>
      <p className="text-sm text-fm-on-surface-variant mb-4">
        Invita a los contactos de este cliente para que accedan a su propio portal.
      </p>

      <form onSubmit={invite} className="flex flex-col md:flex-row gap-2 mb-4">
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
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-fm-primary text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {isPending ? 'Enviando…' : 'Invitar'}
        </button>
      </form>

      {msg && <p className="text-sm mb-3 text-fm-on-surface-variant">{msg}</p>}

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
