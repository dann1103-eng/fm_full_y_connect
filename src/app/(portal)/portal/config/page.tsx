'use client'

import { useState, useTransition } from 'react'
import { changeMyPassword } from '@/app/actions/profile'
import { PortalAvatarSection } from '@/components/portal/PortalAvatarSection'

export default function PortalConfigPage() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)

    if (newPassword.length < 8) {
      setMsg({ ok: false, text: 'La nueva contraseña debe tener al menos 8 caracteres.' })
      return
    }
    if (newPassword !== confirm) {
      setMsg({ ok: false, text: 'Las contraseñas no coinciden.' })
      return
    }

    startTransition(async () => {
      const result = await changeMyPassword(newPassword)
      if (!result.ok) {
        setMsg({ ok: false, text: result.error ?? 'Error al actualizar la contraseña.' })
        return
      }
      setMsg({ ok: true, text: 'Contraseña establecida correctamente.' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
    })
  }

  return (
    <div className="p-6 max-w-md space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fm-on-surface mb-1">Configuración</h1>
        <p className="text-sm text-fm-on-surface-variant">Tu foto personal y contraseña de acceso al portal.</p>
      </div>

      <PortalAvatarSection />

      <form onSubmit={handleSubmit} className="glass-panel p-5 space-y-4">
        <h2 className="text-base font-semibold text-fm-on-surface">Cambiar contraseña</h2>

        <div className="space-y-1.5">
          <label htmlFor="f-contrase-a-actual-opcion-470d8dfe" className="text-sm font-medium text-fm-on-surface">
            Contraseña actual
            <span className="ml-1 text-xs text-fm-on-surface-variant font-normal">(opcional si es tu primera vez)</span>
          </label>
          <input id="f-contrase-a-actual-opcion-470d8dfe"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Dejar vacío si ingresaste por link de invitación"
            className="w-full rounded-lg border border-fm-outline-variant/40 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="f-nueva-contrase-a-f71a5e61" className="text-sm font-medium text-fm-on-surface">Nueva contraseña</label>
          <input id="f-nueva-contrase-a-f71a5e61"
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-lg border border-fm-outline-variant/40 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="f-confirmar-nueva-contrase-a-06ac2a3a" className="text-sm font-medium text-fm-on-surface">Confirmar nueva contraseña</label>
          <input id="f-confirmar-nueva-contrase-a-06ac2a3a"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-lg border border-fm-outline-variant/40 px-3 py-2 text-sm"
          />
        </div>

        {msg && (
          <p className={`text-sm ${msg.ok ? 'text-fm-primary' : 'text-fm-error'}`}>{msg.text}</p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-fm-primary text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {isPending ? 'Guardando…' : 'Guardar contraseña'}
        </button>
      </form>
    </div>
  )
}
