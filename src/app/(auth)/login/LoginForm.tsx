'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface LoginFormProps {
  agencyLogoUrl: string | null
}

export function LoginForm({ agencyLogoUrl }: LoginFormProps) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [logoError, setLogoError] = useState(false)

  const showLogo = agencyLogoUrl && !logoError

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (authError) {
      if (authError.message.toLowerCase().includes('fetch') ||
          authError.message.toLowerCase().includes('network') ||
          authError.message.toLowerCase().includes('failed')) {
        setError('No se pudo conectar al servidor. Revisa tu conexión a internet o intenta desde otra red.')
      } else if (authError.message.toLowerCase().includes('email not confirmed')) {
        setError('Tu correo aún no está confirmado. Contacta al administrador.')
      } else {
        setError('Correo o contraseña incorrectos.')
      }
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-fm-background">
      {/* Background decoration */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% -20%, rgba(0,103,92,0.12) 0%, transparent 70%)',
        }}
      />

      <div className="relative w-full max-w-md px-4">
        {/* Logo card */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl mb-4 shadow-lg overflow-hidden flex items-center justify-center"
            style={
              !showLogo
                ? { background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }
                : undefined
            }
          >
            {showLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={agencyLogoUrl!}
                alt="FM Communication Solutions"
                className="w-full h-full object-cover"
                onError={() => setLogoError(true)}
              />
            ) : (
              <span className="text-white font-bold text-2xl">FM</span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-fm-on-surface">FM Communication</h1>
          <p className="text-fm-on-surface-variant text-sm mt-1">Solutions — CRM Interno</p>
        </div>

        {/* Form card */}
        <div className="bg-fm-surface-container-lowest rounded-2xl shadow-sm border border-fm-outline-variant/20 p-8">
          <h2 className="text-lg font-semibold text-fm-on-surface mb-1">Iniciar sesión</h2>
          <p className="text-sm text-fm-on-surface-variant mb-6">
            Accede con tu cuenta de agencia.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-fm-on-surface font-medium">
                Correo electrónico
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="tu@agencia.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="bg-fm-background border-fm-surface-container-high focus:border-fm-primary focus:ring-fm-primary/20"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-fm-on-surface font-medium">
                Contraseña
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="bg-fm-background border-fm-surface-container-high focus:border-fm-primary focus:ring-fm-primary/20"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-fm-error bg-fm-error/5 border border-fm-error/20 rounded-lg px-3 py-2.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                </svg>
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 font-semibold text-white rounded-xl mt-2"
              style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
            >
              {loading ? 'Ingresando...' : 'Ingresar'}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-fm-on-surface-variant mt-6">
          ¿Problemas para ingresar? Contacta al administrador.
        </p>
      </div>
    </div>
  )
}
