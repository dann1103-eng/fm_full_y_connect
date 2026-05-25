'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createClientUserMulti,
  setClientUserAssignments,
  revokeAllClientUser,
  type PortalUserListed,
} from '@/app/actions/clientUsers'
import { startImpersonation } from '@/app/actions/impersonation'

interface Props {
  initialUsers: PortalUserListed[]
  clients: { id: string; name: string }[]
}

type Mode = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; user: PortalUserListed }

export function PortalUsersClient({ initialUsers, clients }: Props) {
  const router = useRouter()
  const [users] = useState(initialUsers)
  const [mode, setMode] = useState<Mode>({ kind: 'closed' })
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([])
  const [canBilling, setCanBilling] = useState(true)
  const [canWork, setCanWork] = useState(true)

  function openCreate() {
    setMode({ kind: 'create' })
    setEmail('')
    setFullName('')
    setPassword('')
    setSelectedClientIds([])
    setCanBilling(true)
    setCanWork(true)
    setError(null)
  }

  function openEdit(user: PortalUserListed) {
    setMode({ kind: 'edit', user })
    setEmail(user.email)
    setFullName(user.full_name)
    setPassword('')
    setSelectedClientIds(user.clients.map((c) => c.id))
    // Heredar permisos del primer cliente vinculado (si hay heterogeneidad,
    // editar uniformiza). Si no hay marcas, default a ambos.
    const first = user.clients[0]
    setCanBilling(first?.can_billing ?? true)
    setCanWork(first?.can_work ?? true)
    setError(null)
  }

  function close() {
    setMode({ kind: 'closed' })
    setError(null)
  }

  function toggleClient(clientId: string) {
    setSelectedClientIds((prev) =>
      prev.includes(clientId) ? prev.filter((id) => id !== clientId) : [...prev, clientId],
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (mode.kind === 'create') {
      if (!email.trim() || !password || selectedClientIds.length === 0) {
        setError('Email, contraseña y al menos una marca son obligatorios')
        return
      }
      if (!canBilling && !canWork) {
        setError('Selecciona al menos un permiso (Facturación o Gestión de trabajo)')
        return
      }
      startTransition(async () => {
        const r = await createClientUserMulti({
          email: email.trim(),
          password,
          fullName: fullName.trim() || undefined,
          clientIds: selectedClientIds,
          permissions: { can_billing: canBilling, can_work: canWork },
        })
        if (!r.ok) {
          setError(r.error)
          return
        }
        close()
        router.refresh()
      })
    } else if (mode.kind === 'edit') {
      if (selectedClientIds.length === 0) {
        setError('Selecciona al menos una marca, o usa "Revocar acceso" para eliminar al usuario')
        return
      }
      if (!canBilling && !canWork) {
        setError('Selecciona al menos un permiso (Facturación o Gestión de trabajo)')
        return
      }
      startTransition(async () => {
        const r = await setClientUserAssignments({
          userId: mode.user.user_id,
          clientIds: selectedClientIds,
          permissions: { can_billing: canBilling, can_work: canWork },
        })
        if (!r.ok) {
          setError(r.error)
          return
        }
        close()
        router.refresh()
      })
    }
  }

  function handleRevoke() {
    if (mode.kind !== 'edit') return
    if (!confirm(`¿Revocar el acceso de ${mode.user.email} al portal? Su cuenta se eliminará.`)) return
    setError(null)
    startTransition(async () => {
      const r = await revokeAllClientUser(mode.user.user_id)
      if (!r.ok) {
        setError(r.error)
        return
      }
      close()
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fm-on-surface-variant">
          Gestiona las credenciales del portal y a qué marcas tiene acceso cada usuario cliente.
        </p>
        <Button
          onClick={openCreate}
          className="rounded-xl text-white font-semibold"
          style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
        >
          + Nuevo usuario portal
        </Button>
      </div>

      <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 overflow-hidden">
        {users.length === 0 ? (
          <div className="p-8 text-center text-sm text-fm-on-surface-variant">
            Aún no hay usuarios del portal.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-fm-surface-container-low text-fm-on-surface-variant">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">Email</th>
                <th className="text-left px-4 py-2.5 font-semibold">Nombre</th>
                <th className="text-left px-4 py-2.5 font-semibold">Marcas asignadas</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} className="border-t border-fm-surface-container-high/40">
                  <td className="px-4 py-2.5 text-fm-on-surface">{u.email}</td>
                  <td className="px-4 py-2.5 text-fm-on-surface-variant">{u.full_name || '—'}</td>
                  <td className="px-4 py-2.5">
                    {u.clients.length === 0 ? (
                      <span className="text-xs text-fm-error">Sin marcas</span>
                    ) : (
                      <div className="flex flex-wrap gap-1 items-center">
                        {u.clients.map((c) => (
                          <span
                            key={c.id}
                            className="text-[11px] px-2 py-0.5 rounded-full bg-fm-primary/10 text-fm-primary border border-fm-primary/20"
                          >
                            {c.name}
                          </span>
                        ))}
                        {(() => {
                          const first = u.clients[0]
                          const billing = first?.can_billing
                          const work = first?.can_work
                          return (
                            <span className="inline-flex items-center gap-1 ml-1">
                              {billing && (
                                <span
                                  title="Facturación"
                                  className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-purple-50 text-purple-600 border border-purple-200 dark:bg-purple-500/20 dark:text-purple-200 dark:border-purple-400/30"
                                >
                                  <span className="material-symbols-outlined text-[14px] leading-none">receipt_long</span>
                                </span>
                              )}
                              {work && (
                                <span
                                  title="Gestión de trabajo"
                                  className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-lime-50 text-lime-700 border border-lime-200 dark:bg-lime-500/20 dark:text-lime-200 dark:border-lime-400/30"
                                >
                                  <span className="material-symbols-outlined text-[14px] leading-none">task_alt</span>
                                </span>
                              )}
                            </span>
                          )
                        })()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex items-center gap-3">
                      <form action={startImpersonation.bind(null, u.user_id)} className="inline">
                        <button
                          type="submit"
                          title={`Ver como ${u.full_name || u.email}`}
                          className="text-xs font-semibold text-amber-700 dark:text-amber-400 hover:underline inline-flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-sm">visibility</span>
                          Ver como
                        </button>
                      </form>
                      <button type="button"
                        onClick={() => openEdit(u)}
                        className="text-xs font-semibold text-fm-primary hover:underline"
                      >
                        Editar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {mode.kind !== 'closed' && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={close}>
          <div
            className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-fm-on-surface">
              {mode.kind === 'create' ? 'Nuevo usuario portal' : `Editar ${mode.user.email}`}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={mode.kind === 'edit' || isPending}
                  required
                  className="rounded-xl bg-fm-background border-fm-surface-container-high"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Nombre</Label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  disabled={isPending || mode.kind === 'edit'}
                  className="rounded-xl bg-fm-background border-fm-surface-container-high"
                />
              </div>

              {mode.kind === 'create' && (
                <div className="space-y-1.5">
                  <Label>Contraseña * (mín. 8 caracteres)</Label>
                  <Input
                    type="text"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isPending}
                    required
                    minLength={8}
                    className="rounded-xl bg-fm-background border-fm-surface-container-high"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Permisos *</Label>
                <div className="rounded-xl border border-fm-surface-container-high bg-fm-background p-3 space-y-2">
                  <label htmlFor="f-facturaci-n-ve-facturas-24dbb943" className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canBilling}
                      onChange={(e) => setCanBilling(e.target.checked)}
                      disabled={isPending}
                      className="h-4 w-4 mt-0.5 accent-fm-primary"
                    />
                    <div>
                      <p className="text-sm font-medium text-fm-on-surface">Facturación</p>
                      <p className="text-xs text-fm-on-surface-variant">
                        Ve facturas, cotizaciones y pagos de la marca.
                      </p>
                    </div>
                  </label>
                  <label htmlFor="f-gesti-n-de-trabajo-solic-e7d4a7c7" className="flex items-start gap-2 cursor-pointer">
                    <input id="f-facturaci-n-ve-facturas-24dbb943"
                      type="checkbox"
                      checked={canWork}
                      onChange={(e) => setCanWork(e.target.checked)}
                      disabled={isPending}
                      className="h-4 w-4 mt-0.5 accent-fm-primary"
                    />
                    <div>
                      <p className="text-sm font-medium text-fm-on-surface">Gestión de trabajo</p>
                      <p className="text-xs text-fm-on-surface-variant">
                        Solicita requerimientos, ve pipeline, revisión y chat.
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Marcas asignadas *</Label>
                <div className="max-h-60 overflow-y-auto rounded-xl border border-fm-surface-container-high bg-fm-background p-2 space-y-1">
                  {clients.length === 0 ? (
                    <p className="text-xs text-fm-on-surface-variant px-2 py-1">No hay marcas creadas.</p>
                  ) : (
                    clients.map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-fm-surface-container-low cursor-pointer"
                      >
                        <input id="f-gesti-n-de-trabajo-solic-e7d4a7c7"
                          type="checkbox"
                          checked={selectedClientIds.includes(c.id)}
                          onChange={() => toggleClient(c.id)}
                          disabled={isPending}
                          className="h-4 w-4 accent-fm-primary"
                        />
                        <span className="text-sm text-fm-on-surface">{c.name}</span>
                      </label>
                    ))
                  )}
                </div>
                <p className="text-xs text-fm-outline">
                  El usuario verá un selector de marca en el portal si tiene más de una asignada.
                </p>
              </div>

              {error && (
                <p className="text-sm text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">
                  {error}
                </p>
              )}

              <div className="flex gap-2 justify-between pt-2">
                {mode.kind === 'edit' && (
                  <Button
                    type="button"
                    onClick={handleRevoke}
                    disabled={isPending}
                    variant="outline"
                    className="rounded-xl text-fm-error border-fm-error/30 hover:bg-fm-error/5"
                  >
                    Revocar acceso
                  </Button>
                )}
                <div className="flex gap-2 ml-auto">
                  <Button type="button" onClick={close} disabled={isPending} variant="outline" className="rounded-xl">
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={isPending}
                    className="rounded-xl text-white font-semibold"
                    style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
                  >
                    {isPending ? 'Guardando…' : 'Guardar'}
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
