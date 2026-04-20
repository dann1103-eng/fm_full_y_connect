'use client'

import { useRef, useState, useTransition } from 'react'
import { TopNav } from '@/components/layout/TopNav'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { useUser } from '@/contexts/UserContext'
import { createClient } from '@/lib/supabase/client'
import { uploadUserAvatar } from '@/lib/supabase/upload-avatar'
import { updateMyProfile } from '@/app/actions/profile'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  operator: 'Operador',
}

export default function ProfilePage() {
  const user = useUser()

  const [name, setName] = useState(user.full_name)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatar_url ?? null)
  const [uploading, setUploading] = useState(false)
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [pwMessage, setPwMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setProfileMsg(null)
    try {
      const url = await uploadUserAvatar(file, user.id)
      setAvatarUrl(url)
      startTransition(async () => {
        const res = await updateMyProfile({ avatarUrl: url })
        if (res.error) setProfileMsg({ type: 'error', text: res.error })
      })
    } catch (err) {
      setProfileMsg({ type: 'error', text: err instanceof Error ? err.message : 'Error al subir foto.' })
    } finally {
      setUploading(false)
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault()
    setProfileMsg(null)
    startTransition(async () => {
      const res = await updateMyProfile({ fullName: name })
      if (res.error) setProfileMsg({ type: 'error', text: res.error })
      else setProfileMsg({ type: 'success', text: 'Perfil actualizado.' })
    })
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setPwMessage({ type: 'error', text: 'Las contraseñas no coinciden.' })
      return
    }
    if (newPassword.length < 8) {
      setPwMessage({ type: 'error', text: 'La contraseña debe tener al menos 8 caracteres.' })
      return
    }
    setPwLoading(true)
    setPwMessage(null)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setPwMessage({ type: 'error', text: 'Error al actualizar la contraseña.' })
    } else {
      setPwMessage({ type: 'success', text: 'Contraseña actualizada correctamente.' })
      setNewPassword('')
      setConfirmPassword('')
    }
    setPwLoading(false)
  }

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Mi perfil" />

      <div className="flex-1 p-6 space-y-6 max-w-lg">

        {/* Avatar + name */}
        <div className="bg-white rounded-2xl border border-[#dfe3e6] p-6 space-y-5">
          <h2 className="text-base font-bold text-[#2c2f31]">Información personal</h2>

          {/* Avatar */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <UserAvatar name={user.full_name} avatarUrl={avatarUrl} size="lg" />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="absolute -bottom-1 -right-1 w-6 h-6 bg-[#00675c] text-white rounded-full flex items-center justify-center hover:bg-[#005047] transition-colors disabled:opacity-60"
                title="Cambiar foto"
              >
                <span className="material-symbols-outlined text-sm leading-none">photo_camera</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#2c2f31]">{user.full_name}</p>
              <p className="text-xs text-[#595c5e]">{user.email}</p>
              <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#00675c]/10 text-[#00675c]">
                {ROLE_LABELS[user.role] ?? user.role}
              </span>
            </div>
          </div>

          {/* Name edit */}
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nombre completo</Label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Tu nombre"
                required
                className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]"
              />
            </div>

            {profileMsg && (
              <div className={`text-sm rounded-xl px-3 py-2 border ${
                profileMsg.type === 'success'
                  ? 'text-[#00675c] bg-[#00675c]/5 border-[#00675c]/20'
                  : 'text-[#b31b25] bg-[#b31b25]/5 border-[#b31b25]/20'
              }`}>
                {profileMsg.text}
              </div>
            )}

            <Button
              type="submit"
              disabled={isPending || uploading}
              className="w-full rounded-xl text-white font-semibold"
              style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
            >
              {isPending ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </form>
        </div>

        {/* Password change */}
        <div className="bg-white rounded-2xl border border-[#dfe3e6] p-6 space-y-4">
          <h2 className="text-base font-bold text-[#2c2f31]">Cambiar contraseña</h2>

          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nueva contraseña</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                required
                className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Confirmar nueva contraseña</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repite la contraseña"
                required
                className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]"
              />
            </div>

            {pwMessage && (
              <div className={`text-sm rounded-xl px-3 py-2 border ${
                pwMessage.type === 'success'
                  ? 'text-[#00675c] bg-[#00675c]/5 border-[#00675c]/20'
                  : 'text-[#b31b25] bg-[#b31b25]/5 border-[#b31b25]/20'
              }`}>
                {pwMessage.text}
              </div>
            )}

            <Button
              type="submit"
              disabled={pwLoading}
              className="w-full rounded-xl text-white font-semibold"
              style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
            >
              {pwLoading ? 'Actualizando...' : 'Actualizar contraseña'}
            </Button>
          </form>
        </div>

      </div>
    </div>
  )
}
