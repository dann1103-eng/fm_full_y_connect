'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { updateClientProfile } from '@/app/actions/clientProfile'

// Lee el activeClientId de la cookie en el cliente
// La cookie se llama 'portal_active_client'
const COOKIE_NAME = 'portal_active_client'

function getActiveClientIdFromCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.split(';').find((c) => c.trim().startsWith(COOKIE_NAME + '='))
  return match ? decodeURIComponent(match.split('=')[1].trim()) : null
}

export default function PortalEmpresaPage() {
  // Use a ref so we never call setState synchronously inside an effect
  const clientIdRef = useRef<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  // null = loading, false = no active client, true = loaded
  const [status, setStatus] = useState<'loading' | 'no-client' | 'ready'>('loading')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const id = getActiveClientIdFromCookie()
    clientIdRef.current = id

    Promise.resolve(id).then((resolvedId) => {
      if (!resolvedId) {
        setStatus('no-client')
        return
      }

      const supabase = createClient()
      supabase
        .from('clients')
        .select('name, contact_email, contact_phone, ig_handle, fb_handle, tiktok_handle, yt_handle, linkedin_handle, website_url, other_contact, legal_name, nit, nrc, dui, fiscal_address, giro')
        .eq('id', resolvedId)
        .single()
        .then(({ data }) => {
          if (data) {
            // Convert nulls to empty strings for controlled inputs
            const flat: Record<string, string> = {}
            for (const [k, v] of Object.entries(data)) {
              flat[k] = v ?? ''
            }
            setForm(flat)
          }
          setStatus('ready')
        })
    })
  }, [])

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const clientId = clientIdRef.current
    if (!clientId) return
    setMsg(null)
    startTransition(async () => {
      try {
        // Convert empty strings back to null
        const payload: Record<string, string | null> = {}
        for (const [k, v] of Object.entries(form)) {
          payload[k] = v.trim() || null
        }
        // name is required
        if (!payload['name']) {
          setMsg({ ok: false, text: 'El nombre de la empresa es requerido.' })
          return
        }
        await updateClientProfile(clientId, payload)
        setMsg({ ok: true, text: 'Datos actualizados correctamente.' })
      } catch (err) {
        setMsg({ ok: false, text: err instanceof Error ? err.message : 'Error al guardar' })
      }
    })
  }

  if (status === 'loading') return <div className="p-6 text-sm text-fm-on-surface-variant">Cargando…</div>
  if (status === 'no-client') return <div className="p-6 text-sm text-fm-error">Sin empresa activa.</div>

  const field = (key: string, label: string, type = 'text') => (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-fm-on-surface">{label}</label>
      <input
        type={type}
        value={form[key] ?? ''}
        onChange={(e) => set(key, e.target.value)}
        className="w-full rounded-lg border border-fm-outline-variant/40 px-3 py-2 text-sm"
      />
    </div>
  )

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fm-on-surface mb-1">Mi empresa</h1>
        <p className="text-sm text-fm-on-surface-variant">
          Edita los datos de contacto y redes sociales de tu empresa.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Datos generales */}
        <section className="glass-panel p-5 space-y-4">
          <h2 className="text-base font-semibold text-fm-on-surface">Datos generales</h2>
          {field('name', 'Nombre de la empresa')}
          {field('contact_email', 'Email de contacto', 'email')}
          {field('contact_phone', 'Teléfono de contacto', 'tel')}
          {field('website_url', 'Sitio web', 'url')}
          {field('other_contact', 'Otro contacto')}
        </section>

        {/* Redes sociales */}
        <section className="glass-panel p-5 space-y-4">
          <h2 className="text-base font-semibold text-fm-on-surface">Redes sociales</h2>
          {field('ig_handle', 'Instagram (@usuario)')}
          {field('fb_handle', 'Facebook (@página)')}
          {field('tiktok_handle', 'TikTok (@usuario)')}
          {field('yt_handle', 'YouTube (canal)')}
          {field('linkedin_handle', 'LinkedIn (empresa)')}
        </section>

        {/* Datos fiscales */}
        <section className="glass-panel p-5 space-y-4">
          <h2 className="text-base font-semibold text-fm-on-surface">Datos fiscales</h2>
          {field('legal_name', 'Razón social')}
          {field('nit', 'NIT')}
          {field('nrc', 'NRC')}
          {field('dui', 'DUI')}
          {field('giro', 'Giro')}
          {field('fiscal_address', 'Dirección fiscal')}
        </section>

        {msg && (
          <p className={`text-sm ${msg.ok ? 'text-fm-primary' : 'text-fm-error'}`}>{msg.text}</p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-fm-primary text-white px-6 py-2 text-sm font-medium disabled:opacity-50"
        >
          {isPending ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </form>
    </div>
  )
}
