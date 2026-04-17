'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { TopNav } from '@/components/layout/TopNav'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Client, Plan, ContentType } from '@/types/db'
import { effectiveWeeklyTarget } from '@/lib/domain/consumption'
import { limitsToRecord, CONTENT_TYPE_LABELS } from '@/lib/domain/plans'

export default function ClientEditPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params.id

  const [client, setClient] = useState<Client | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [weeklyTargets, setWeeklyTargets] = useState<Partial<Record<ContentType, number>>>({})
  const [limits, setLimits] = useState<Record<ContentType, number> | null>(null)

  const [form, setForm] = useState({
    name: '',
    contact_email: '',
    contact_phone: '',
    ig_handle: '',
    fb_handle: '',
    tiktok_handle: '',
    yt_handle: '',
    linkedin_handle: '',
    website_url: '',
    other_contact: '',
    notes: '',
    current_plan_id: '',
    billing_day: '1',
  })

  useEffect(() => {
    async function load() {
      const supabase = createClient()

      const { data: { user } } = await supabase.auth.getUser()
      const { data: appUser } = user
        ? await supabase.from('users').select('role').eq('id', user.id).single()
        : { data: null }
      if (appUser?.role !== 'admin') {
        router.replace(`/clients/${id}`)
        return
      }

      const [{ data: clientData }, { data: plansData }] = await Promise.all([
        supabase.from('clients').select('*').eq('id', id).single(),
        supabase.from('plans').select('*').eq('active', true).order('price_usd'),
      ])

      if (!clientData) { router.replace('/clients'); return }

      setClient(clientData)
      setPlans(plansData ?? [])
      setForm({
        name: clientData.name,
        contact_email: clientData.contact_email ?? '',
        contact_phone: clientData.contact_phone ?? '',
        ig_handle: clientData.ig_handle ?? '',
        fb_handle: clientData.fb_handle ?? '',
        tiktok_handle: clientData.tiktok_handle ?? '',
        yt_handle: clientData.yt_handle ?? '',
        linkedin_handle: clientData.linkedin_handle ?? '',
        website_url: clientData.website_url ?? '',
        other_contact: clientData.other_contact ?? '',
        notes: clientData.notes ?? '',
        current_plan_id: clientData.current_plan_id,
        billing_day: clientData.billing_day.toString(),
      })
      setWeeklyTargets(clientData.weekly_targets_json ?? {})
      const activePlan = (plansData ?? []).find((p) => p.id === clientData.current_plan_id)
      const activeLimits = activePlan ? limitsToRecord(activePlan.limits_json) : null
      setLimits(activeLimits)
      setFetching(false)
    }
    load()
  }, [id, router])

  function set(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function buildWeeklyTargetsJson(
    targets: Partial<Record<ContentType, number | undefined>>,
    activeLimits: Record<ContentType, number> | null
  ): Partial<Record<ContentType, number>> | null {
    if (!activeLimits) return null
    const result: Partial<Record<ContentType, number>> = {}
    for (const [type, val] of Object.entries(targets) as [ContentType, number | undefined][]) {
      if (val !== undefined && val !== effectiveWeeklyTarget(type, activeLimits[type] ?? 0, null)) {
        result[type] = val
      }
    }
    return Object.keys(result).length > 0 ? result : null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error: updateError } = await supabase
      .from('clients')
      .update({
        name: form.name,
        contact_email: form.contact_email || null,
        contact_phone: form.contact_phone || null,
        ig_handle: form.ig_handle || null,
        fb_handle: form.fb_handle || null,
        tiktok_handle: form.tiktok_handle || null,
        yt_handle: form.yt_handle || null,
        linkedin_handle: form.linkedin_handle || null,
        website_url: form.website_url || null,
        other_contact: form.other_contact || null,
        notes: form.notes || null,
        current_plan_id: form.current_plan_id,
        billing_day: parseInt(form.billing_day, 10),
        weekly_targets_json: buildWeeklyTargetsJson(weeklyTargets, limits),
      })
      .eq('id', id)

    if (updateError) {
      setError('Error al guardar los cambios.')
      setLoading(false)
      return
    }

    router.push(`/clients/${id}`)
    router.refresh()
  }

  if (fetching) {
    return (
      <div className="flex flex-col h-full">
        <TopNav title="Editar cliente" />
        <div className="flex-1 flex items-center justify-center text-[#595c5e] text-sm">
          Cargando...
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Editar cliente" />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-[#595c5e] mb-5">
            <Link href="/clients" className="hover:text-[#00675c] transition-colors">Clientes</Link>
            <span>/</span>
            <Link href={`/clients/${id}`} className="hover:text-[#00675c] transition-colors">{client?.name}</Link>
            <span>/</span>
            <span className="text-[#2c2f31] font-medium">Editar</span>
          </div>

          <div className="bg-white rounded-2xl border border-[#abadaf]/20 p-6">
            <h2 className="text-lg font-semibold text-[#2c2f31] mb-5">Editar datos del cliente</h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">

                <div className="col-span-2 space-y-1.5">
                  <Label>Nombre *</Label>
                  <Input required value={form.name} onChange={(e) => set('name', e.target.value)}
                    className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]" />
                </div>

                <div className="space-y-1.5">
                  <Label>Plan *</Label>
                  <select required value={form.current_plan_id} onChange={(e) => set('current_plan_id', e.target.value)}
                    className="w-full py-2 px-3 text-sm bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl text-[#2c2f31] focus:outline-none focus:border-[#00675c]">
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} — ${p.price_usd}</option>
                    ))}
                  </select>
                  <p className="text-xs text-[#747779]">El cambio aplica al siguiente ciclo.</p>
                </div>

                <div className="space-y-1.5">
                  <Label>Día de facturación *</Label>
                  <Input required type="number" min={1} max={31} value={form.billing_day}
                    onChange={(e) => set('billing_day', e.target.value)}
                    className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]" />
                </div>

                <div className="space-y-1.5">
                  <Label>Correo de contacto</Label>
                  <Input type="email" value={form.contact_email} onChange={(e) => set('contact_email', e.target.value)}
                    placeholder="cliente@email.com" className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]" />
                </div>

                <div className="space-y-1.5">
                  <Label>Teléfono</Label>
                  <Input value={form.contact_phone} onChange={(e) => set('contact_phone', e.target.value)}
                    placeholder="+503 7000 0000" className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]" />
                </div>

                {/* ── Redes sociales ── */}
                <div className="col-span-2 pt-1">
                  <p className="text-xs font-semibold text-[#abadaf] uppercase tracking-widest mb-3">
                    Redes sociales y contacto digital
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Instagram</Label>
                      <Input value={form.ig_handle} onChange={(e) => set('ig_handle', e.target.value)}
                        placeholder="@handle" className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Facebook</Label>
                      <Input value={form.fb_handle} onChange={(e) => set('fb_handle', e.target.value)}
                        placeholder="nombre de página o URL" className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>TikTok</Label>
                      <Input value={form.tiktok_handle} onChange={(e) => set('tiktok_handle', e.target.value)}
                        placeholder="@handle" className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>YouTube</Label>
                      <Input value={form.yt_handle} onChange={(e) => set('yt_handle', e.target.value)}
                        placeholder="@canal o nombre" className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>LinkedIn</Label>
                      <Input value={form.linkedin_handle} onChange={(e) => set('linkedin_handle', e.target.value)}
                        placeholder="nombre de empresa o URL" className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Sitio web</Label>
                      <Input value={form.website_url} onChange={(e) => set('website_url', e.target.value)}
                        placeholder="https://ejemplo.com" className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]" />
                    </div>
                    <div className="col-span-2 space-y-1.5">
                      <Label>Otro <span className="text-[#abadaf] font-normal">(WhatsApp, Threads, etc.)</span></Label>
                      <Input value={form.other_contact} onChange={(e) => set('other_contact', e.target.value)}
                        placeholder="descripción y enlace o handle" className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]" />
                    </div>
                  </div>
                </div>

                {/* ── Objetivos semanales ── */}
                {limits && (
                  <div className="col-span-2 pt-1">
                    <p className="text-xs font-semibold text-[#abadaf] uppercase tracking-widest mb-3">
                      Objetivos semanales{' '}
                      <span className="normal-case font-normal text-[#747779]">
                        (descriptivo, no restringe — default: límite ÷ 4)
                      </span>
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {(Object.entries(limits) as [ContentType, number][])
                        .filter(([, lim]) => lim > 0)
                        .map(([type, lim]) => {
                          const defaultVal = effectiveWeeklyTarget(type, lim, null)
                          return (
                            <div key={type} className="space-y-1.5">
                              <Label>
                                {CONTENT_TYPE_LABELS[type]}{' '}
                                <span className="text-[#abadaf] font-normal text-xs">
                                  (def. {defaultVal}/sem)
                                </span>
                              </Label>
                              <Input
                                type="number"
                                min={0}
                                placeholder={String(defaultVal)}
                                value={weeklyTargets[type] ?? ''}
                                onChange={(e) =>
                                  setWeeklyTargets((prev) => ({
                                    ...prev,
                                    [type]: e.target.value === '' ? undefined : Number(e.target.value),
                                  }))
                                }
                                className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]"
                              />
                            </div>
                          )
                        })}
                    </div>
                  </div>
                )}

                <div className="col-span-2 space-y-1.5">
                  <Label>Notas internas</Label>
                  <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)}
                    placeholder="Detalles adicionales sobre el cliente..."
                    className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6] resize-none" rows={3} />
                </div>
              </div>

              {error && (
                <p className="text-sm text-[#b31b25] bg-[#b31b25]/5 rounded-xl px-3 py-2 border border-[#b31b25]/20">
                  {error}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <Button type="button" variant="outline" onClick={() => router.back()} className="flex-1 rounded-xl">
                  Cancelar
                </Button>
                <Button type="submit" disabled={loading} className="flex-1 rounded-xl text-white font-semibold"
                  style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}>
                  {loading ? 'Guardando...' : 'Guardar cambios'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
