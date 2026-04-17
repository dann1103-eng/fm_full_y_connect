'use client'

import { useState } from 'react'
import { TopNav } from '@/components/layout/TopNav'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

export default function ProfilePage() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'Las contraseñas no coinciden.' })
      return
    }
    if (newPassword.length < 8) {
      setMessage({ type: 'error', text: 'La contraseña debe tener al menos 8 caracteres.' })
      return
    }

    setLoading(true)
    setMessage(null)

    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: newPassword })

    if (error) {
      setMessage({ type: 'error', text: 'Error al actualizar la contraseña.' })
    } else {
      setMessage({ type: 'success', text: 'Contraseña actualizada correctamente.' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }
    setLoading(false)
  }

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Ajustes" />

      <div className="flex-1 p-6">
        <div className="max-w-md">
          <div className="bg-white rounded-2xl border border-[#abadaf]/20 p-6">
            <h2 className="text-lg font-semibold text-[#2c2f31] mb-1">Cambiar contraseña</h2>
            <p className="text-sm text-[#595c5e] mb-5">
              Actualiza tu contraseña de acceso al CRM.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nueva contraseña</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
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
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repite la contraseña"
                  required
                  className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]"
                />
              </div>

              {message && (
                <div
                  className={`text-sm rounded-xl px-3 py-2 border ${
                    message.type === 'success'
                      ? 'text-[#00675c] bg-[#00675c]/5 border-[#00675c]/20'
                      : 'text-[#b31b25] bg-[#b31b25]/5 border-[#b31b25]/20'
                  }`}
                >
                  {message.text}
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl text-white font-semibold"
                style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
              >
                {loading ? 'Actualizando...' : 'Actualizar contraseña'}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
