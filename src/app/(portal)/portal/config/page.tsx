'use client'

import { useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'

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
      const supabase = createClient()

      // Si el usuario ingresó su contraseña actual, re-autenticar primero.
      // Si la dejó vacía (p.ej. primera vez con link de invitación), saltar este paso.
      if (currentPassword) {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user?.email) {
          setMsg({ ok: false, text: 'No se pudo obtener tu sesión. Recarga la página.' })
          return
        }
        const { error: reAuthErr } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: currentPassword,
        })
        if (reAuthErr) {
          setMsg({ ok: false, text: 'Contraseña actual incorrecta.' })
          return
        }
      }

      const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword })
      if (updateErr) {
        if (updateErr.message.toLowerCase().includes('reauthentication')) {
          setMsg({ ok: false, text: 'Tu sesión expiró. Por favor cierra sesión, ingresa nuevamente y vuelve a intentarlo.' })
        } else {
          setMsg({ ok: false, text: `Error al actualizar: ${updateErr.message}` })
        }
        return
      }

      setMsg({ ok: true, text: 'Contraseña establecida correctamente.' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
    })
  }

  return (
    <div className="p-6 max-w-md">
      <h1 className="text-xl font-semibold text-fm-on-surface mb-1">Configuración</h1>
      <p className="text-sm text-fm-on-surface-variant mb-6">Establece o cambia tu contraseña de acceso al portal.</p>

      <form onSubmit={handleSubmit} className="glass-panel p-5 space-y-4">
        <h2 className="text-base font-semibold text-fm-on-surface">Cambiar contraseña</h2>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-fm-on-surface">
            Contraseña actual
            <span className="ml-1 text-xs text-fm-on-surface-variant font-normal">(opcional si es tu primera vez)</span>
          </label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Dejar vacío si ingresaste por link de invitación"
            className="w-full rounded-lg border border-fm-outline-variant/40 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-fm-on-surface">Nueva contraseña</label>
          <input
            type="password"
            required
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-lg border border-fm-outline-variant/40 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-fm-on-surface">Confirmar nueva contraseña</label>
          <input
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
