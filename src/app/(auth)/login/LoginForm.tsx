'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BackgroundShader } from '@/components/ui/background-shaders'

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
  const [mode, setMode] = useState<'password' | 'magic'>('password')
  const [magicSent, setMagicSent] = useState(false)

  const showLogo = agencyLogoUrl && !logoError
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? ''

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

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

    const { data: { user } } = await supabase.auth.getUser()
    let destination = '/dashboard'
    if (user) {
      const { data: appUser } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      if (appUser?.role === 'client') destination = '/portal/dashboard'
    }

    router.push(destination)
    router.refresh()
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${siteUrl}/auth/callback?next=/portal/dashboard`,
      },
    })

    setLoading(false)
    if (otpError) {
      if (otpError.message.toLowerCase().includes('not found') || otpError.message.toLowerCase().includes('signups not allowed')) {
        setError('No encontramos una cuenta con ese correo. Contacta a tu agencia para recibir una invitación.')
      } else {
        setError(`No se pudo enviar el link: ${otpError.message}`)
      }
      return
    }

    setMagicSent(true)
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative">
      <BackgroundShader />

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
          <h1 className="text-2xl font-bold text-white drop-shadow-md">FM Communication</h1>
          <p className="text-white/90 text-sm mt-1 drop-shadow">Solutions — CRM Interno</p>
        </div>

        {/* Form card */}
        <div className="bg-white/85 backdrop-blur-xl rounded-2xl shadow-xl border border-white/40 p-8">
          {magicSent ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full bg-fm-primary/10 flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-fm-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-fm-on-surface mb-2">Revisa tu correo</h2>
              <p className="text-sm text-fm-on-surface-variant mb-4">
                Enviamos un link de acceso a <strong>{email}</strong>. Haz clic en él para ingresar al portal.
              </p>
              <button
                onClick={() => { setMagicSent(false); setMode('password') }}
                className="text-sm text-fm-primary hover:underline"
              >
                Volver al inicio de sesión
              </button>
            </div>
          ) : mode === 'password' ? (
            <>
              <h2 className="text-lg font-semibold text-fm-on-surface mb-1">Iniciar sesión</h2>
              <p className="text-sm text-fm-on-surface-variant mb-6">
                Accede con tu cuenta de agencia.
              </p>

              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-fm-on-surface font-medium">
                    Correo electrónico
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="tu@empresa.com"
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

              <div className="mt-4 pt-4 border-t border-fm-outline-variant/30 text-center">
                <p className="text-xs text-fm-on-surface-variant mb-2">¿Accediste por invitación y no tienes contraseña?</p>
                <button
                  onClick={() => { setMode('magic'); setError(null) }}
                  className="text-sm text-fm-primary hover:underline font-medium"
                >
                  Acceder con link por correo
                </button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-fm-on-surface mb-1">Acceder con link</h2>
              <p className="text-sm text-fm-on-surface-variant mb-6">
                Te enviaremos un link de acceso directo a tu correo. No necesitas contraseña.
              </p>

              <form onSubmit={handleMagicLink} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email-magic" className="text-fm-on-surface font-medium">
                    Correo electrónico
                  </Label>
                  <Input
                    id="email-magic"
                    type="email"
                    placeholder="tu@empresa.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
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
                  {loading ? 'Enviando...' : 'Enviar link de acceso'}
                </Button>
              </form>

              <div className="mt-4 pt-4 border-t border-fm-outline-variant/30 text-center">
                <button
                  onClick={() => { setMode('password'); setError(null) }}
                  className="text-sm text-fm-primary hover:underline font-medium"
                >
                  Volver — iniciar sesión con contraseña
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-white/90 drop-shadow mt-6">
          ¿Problemas para ingresar? Contacta al administrador.
        </p>
      </div>
    </div>
  )
}
