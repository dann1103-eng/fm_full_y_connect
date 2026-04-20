'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { TopNav } from '@/components/layout/TopNav'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { BillingPeriod, Client, Plan, BillingCycle, ContentType, CambiosPackage, ExtraContentItem, WeekKey, WeeklyDistribution } from '@/types/db'
import { effectiveWeeklyTarget } from '@/lib/domain/requirement'
import { limitsToRecord, CONTENT_TYPE_LABELS, EXTRA_CONTENT_PRICES } from '@/lib/domain/plans'
import { LogoUploader } from '@/components/clients/LogoUploader'

export default function ClientEditPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params.id

  const [isAdmin, setIsAdmin] = useState(false)
  const [client, setClient] = useState<Client | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [currentCycle, setCurrentCycle] = useState<BillingCycle | null>(null)
  const [loading, setLoading] = useState(false)
  const [cycleLoading, setCycleLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cycleError, setCycleError] = useState<string | null>(null)

  const [weeklyTargets, setWeeklyTargets] = useState<Partial<Record<ContentType, number>>>({})
  const [weeklyDist, setWeeklyDist] = useState<WeeklyDistribution>({})
  const [activeWeekTab, setActiveWeekTab] = useState<WeekKey>('S1')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)

  // Client form
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

  // Admin: cycle config state
  const [cambiosPackages, setCambiosPackages] = useState<CambiosPackage[]>([])
  const [extraContent, setExtraContent] = useState<ExtraContentItem[]>([])
  const [contentOverride, setContentOverride] = useState<Partial<Record<ContentType, number>>>({})
  const [pkgQty, setPkgQty] = useState('5')
  const [pkgPrice, setPkgPrice] = useState('')
  const [pkgNote, setPkgNote] = useState('')
  const [extraType, setExtraType] = useState<ContentType>('video_corto')
  const [extraQty, setExtraQty] = useState('1')
  const [extraNote, setExtraNote] = useState('')
  const [extraIsCustom, setExtraIsCustom] = useState(false)
  const [extraLabel, setExtraLabel] = useState('')
  const [extraPrice, setExtraPrice] = useState('')
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('monthly')
  const [billingDay2, setBillingDay2] = useState('')

  const limits = useMemo(() => {
    const selected = plans.find((p) => p.id === form.current_plan_id)
    return selected ? limitsToRecord(selected.limits_json) : null
  }, [plans, form.current_plan_id])

  const selectedPlan = useMemo(() => plans.find(p => p.id === form.current_plan_id), [plans, form.current_plan_id])

  useEffect(() => {
    async function load() {
      const supabase = createClient()

      const { data: { user } } = await supabase.auth.getUser()
      const { data: appUser } = user
        ? await supabase.from('users').select('role').eq('id', user.id).single()
        : { data: null as { role: string } | null }
      const adminUser = appUser?.role === 'admin' || appUser?.role === 'supervisor'
      setIsAdmin(adminUser)
      if (!adminUser) {
        router.replace(`/clients/${id}`)
        return
      }

      const [{ data: clientDataRaw }, { data: plansData }, { data: cycleData }] = await Promise.all([
        supabase.from('clients').select('*').eq('id', id).single(),
        supabase.from('plans').select('*').eq('active', true).order('price_usd'),
        supabase.from('billing_cycles').select('*').eq('client_id', id).eq('status', 'current').maybeSingle(),
      ])

      const clientData = clientDataRaw as Client | null
      if (!clientData) { router.replace('/clients'); return }

      setClient(clientData)
      setPlans(plansData ?? [])
      setCurrentCycle(cycleData as BillingCycle | null)
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
      setLogoUrl(clientData.logo_url ?? null)
      setWeeklyTargets(clientData.weekly_targets_json ?? {})
      setWeeklyDist((clientData as Client & { weekly_distribution_json?: WeeklyDistribution | null }).weekly_distribution_json ?? {})
      setBillingPeriod(clientData.billing_period)
      setBillingDay2(clientData.billing_day_2?.toString() ?? '')

      if (cycleData) {
        const cycle = cycleData as BillingCycle
        setCambiosPackages((cycle.cambios_packages_json as CambiosPackage[]) ?? [])
        setExtraContent((cycle.extra_content_json as ExtraContentItem[]) ?? [])
        setContentOverride((cycle.content_limits_override_json as Partial<Record<ContentType, number>>) ?? {})
      }

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
        logo_url: logoUrl,
        current_plan_id: form.current_plan_id,
        billing_day: parseInt(form.billing_day, 10),
        weekly_targets_json: buildWeeklyTargetsJson(weeklyTargets, limits),
        weekly_distribution_json: Object.keys(weeklyDist).length > 0 ? weeklyDist : null,
        billing_period: billingPeriod,
        billing_day_2: billingPeriod === 'biweekly' && billingDay2 ? parseInt(billingDay2, 10) : null,
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

  // ── Admin: save cycle config ──
  async function handleSaveCycle() {
    if (!currentCycle) return
    setCycleLoading(true)
    setCycleError(null)
    const supabase = createClient()

    // Recalculate cambios_budget from selected plan
    const budget = selectedPlan?.cambios_included ?? currentCycle.cambios_budget

    const { error } = await supabase
      .from('billing_cycles')
      .update({
        cambios_budget: budget,
        cambios_packages_json: cambiosPackages,
        extra_content_json: extraContent,
        content_limits_override_json: Object.keys(contentOverride).length > 0 ? contentOverride : null,
      })
      .eq('id', currentCycle.id)

    setCycleLoading(false)
    if (error) { setCycleError('Error al guardar la configuración del ciclo.'); return }
    router.refresh()
  }

  function addCambiosPackage() {
    const qty = parseInt(pkgQty) || 0
    if (!qty) return
    setCambiosPackages(prev => [...prev, {
      qty,
      price_usd: parseFloat(pkgPrice) || null,
      note: pkgNote.trim() || null,
      created_at: new Date().toISOString(),
    }])
    setPkgQty('5'); setPkgPrice(''); setPkgNote('')
  }

  function addExtraContent() {
    const qty = parseInt(extraQty) || 1
    if (extraIsCustom) {
      const label = extraLabel.trim()
      const price = parseFloat(extraPrice) || 0
      if (!label || !price) return
      setExtraContent(prev => [...prev, {
        label,
        qty,
        price_per_unit: price,
        note: extraNote.trim() || null,
        created_at: new Date().toISOString(),
      }])
      setExtraLabel(''); setExtraPrice(''); setExtraNote('')
    } else {
      const pricePerUnit = EXTRA_CONTENT_PRICES[extraType] ?? 0
      setExtraContent(prev => [...prev, {
        content_type: extraType,
        label: CONTENT_TYPE_LABELS[extraType],
        qty,
        price_per_unit: pricePerUnit,
        note: extraNote.trim() || null,
        created_at: new Date().toISOString(),
      }])
      setExtraQty('1'); setExtraNote('')
    }
  }

  const totalCambiosBudget = (selectedPlan?.cambios_included ?? currentCycle?.cambios_budget ?? 0)
    + cambiosPackages.reduce((s, p) => s + p.qty, 0)

  const totalExtraRevenue = extraContent.reduce((s, e) => s + e.price_per_unit * e.qty, 0)

  const CONTENT_TYPES_DISPLAY: ContentType[] = ['historia', 'estatico', 'video_corto', 'reel', 'short', 'produccion', 'reunion']

  if (fetching) {
    return (
      <div className="flex flex-col h-full">
        <TopNav title="Editar cliente" />
        <div className="flex-1 flex items-center justify-center text-[#595c5e] text-sm">Cargando...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Editar cliente" />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex gap-6 items-start max-w-6xl">

          {/* ── Left: client form ── */}
          <div className="flex-shrink-0 w-[440px]">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 text-sm text-[#595c5e] mb-5">
              <Link href="/clients" className="hover:text-[#00675c] transition-colors">Clientes</Link>
              <span>/</span>
              <Link href={`/clients/${id}`} className="hover:text-[#00675c] transition-colors">{client?.name}</Link>
              <span>/</span>
              <span className="text-[#2c2f31] font-medium">Editar</span>
            </div>

            <div className="bg-white rounded-2xl border border-[#abadaf]/20 p-6">
              <h2 className="text-lg font-semibold text-[#2c2f31] mb-5">Datos del cliente</h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">

                  <div className="col-span-2 space-y-1.5">
                    <Label>Logo</Label>
                    <LogoUploader
                      value={logoUrl}
                      onChange={setLogoUrl}
                      clientId={id}
                      clientName={form.name || client?.name || ''}
                      disabled={loading}
                    />
                  </div>

                  <div className="col-span-2 space-y-1.5">
                    <Label>Nombre *</Label>
                    <Input required value={form.name} onChange={(e) => set('name', e.target.value)}
                      className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]" />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Plan *</Label>
                    <select required value={form.current_plan_id} onChange={(e) => { set('current_plan_id', e.target.value); setWeeklyTargets({}) }}
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
                    <Label>Período de facturación</Label>
                    <select value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value as BillingPeriod)}
                      className="w-full py-2 px-3 text-sm bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl text-[#2c2f31] focus:outline-none focus:border-[#00675c]">
                      <option value="monthly">Mensual</option>
                      <option value="biweekly">Quincenal</option>
                    </select>
                  </div>

                  {billingPeriod === 'biweekly' && (
                    <div className="space-y-1.5">
                      <Label>2° día de facturación</Label>
                      <Input required type="number" min={1} max={31}
                        value={billingDay2}
                        onChange={(e) => setBillingDay2(e.target.value)}
                        placeholder="ej. 15"
                        className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]" />
                    </div>
                  )}

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

                  {/* Redes sociales */}
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

                  {/* Distribución semanal S1–S4 */}
                  {limits && (
                    <div className="col-span-2 pt-1">
                      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                        <p className="text-xs font-semibold text-[#abadaf] uppercase tracking-widest">
                          Distribución semanal{' '}
                          <span className="normal-case font-normal text-[#747779]">(cuántas piezas por semana)</span>
                        </p>
                        {selectedPlan?.default_weekly_distribution_json && (
                          <button
                            type="button"
                            onClick={() => setWeeklyDist(selectedPlan.default_weekly_distribution_json!)}
                            className="text-xs text-[#00675c] hover:underline"
                          >
                            Restaurar defaults del plan
                          </button>
                        )}
                      </div>

                      {/* Week tabs */}
                      <div className="flex rounded-xl border border-[#dfe3e6] overflow-hidden mb-4 w-fit">
                        {(['S1','S2','S3','S4'] as WeekKey[]).map(w => (
                          <button
                            key={w}
                            type="button"
                            onClick={() => setActiveWeekTab(w)}
                            className={`px-4 py-1.5 text-sm font-semibold transition-colors ${
                              activeWeekTab === w ? 'bg-[#00675c] text-white' : 'text-[#595c5e] hover:bg-[#f5f7f9]'
                            }`}
                          >
                            {w}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        {(Object.entries(limits) as [ContentType, number][])
                          .filter(([type, lim]) => lim > 0 && !['produccion','reunion'].includes(type))
                          .map(([type]) => (
                            <div key={type} className="space-y-1.5">
                              <Label>{CONTENT_TYPE_LABELS[type]}</Label>
                              <Input
                                type="number" min={0}
                                placeholder="0"
                                value={weeklyDist[activeWeekTab]?.[type] ?? ''}
                                onChange={(e) =>
                                  setWeeklyDist(prev => {
                                    const weekSlot = { ...(prev[activeWeekTab] ?? {}) }
                                    if (e.target.value === '') { delete weekSlot[type] }
                                    else { weekSlot[type] = Math.max(0, Number(e.target.value)) }
                                    return { ...prev, [activeWeekTab]: weekSlot }
                                  })
                                }
                                className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]"
                              />
                            </div>
                          ))}
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

          {/* ── Right: admin cycle panel ── */}
          {isAdmin && currentCycle && (
            <div className="flex-1 min-w-0">
              <div className="mb-5 h-[38px] flex items-center gap-2">
                <span className="material-symbols-outlined text-[#b31b25] text-lg">shield</span>
                <span className="text-sm font-semibold text-[#2c2f31]">Configuración del ciclo actual</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#b31b25]/8 text-[#b31b25] border border-[#b31b25]/15">
                  Solo admin
                </span>
              </div>

              <div className="bg-white rounded-2xl border border-[#b31b25]/15 p-6 space-y-6">

                {/* 1. Cambios del ciclo */}
                <div>
                  <p className="text-[11px] font-bold text-[#abadaf] uppercase tracking-wider mb-3">
                    Cambios del ciclo
                  </p>

                  {/* Budget summary */}
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="bg-[#f5f7f9] rounded-xl p-3 border border-[#dfe3e6]">
                      <p className="text-[10px] text-[#595c5e] mb-0.5">Incluidos en plan</p>
                      <p className="text-xl font-bold text-[#2c2f31]">
                        {selectedPlan?.cambios_included ?? currentCycle.cambios_budget}
                      </p>
                    </div>
                    <div className="bg-[#f5f7f9] rounded-xl p-3 border border-[#dfe3e6]">
                      <p className="text-[10px] text-[#595c5e] mb-0.5">Paquetes extra</p>
                      <p className="text-xl font-bold text-[#00675c]">
                        +{cambiosPackages.reduce((s, p) => s + p.qty, 0)}
                      </p>
                    </div>
                    <div className="bg-[#00675c]/08 rounded-xl p-3 border border-[#00675c]/20" style={{ background: 'rgba(0,103,92,.06)' }}>
                      <p className="text-[10px] text-[#595c5e] mb-0.5">Total disponible</p>
                      <p className="text-xl font-bold text-[#00675c]">{totalCambiosBudget}</p>
                    </div>
                  </div>

                  {/* Add package */}
                  <div className="flex gap-2 mb-2">
                    <div className="flex flex-col gap-1 flex-shrink-0 w-20">
                      <label className="text-[10px] font-medium text-[#595c5e]">Cantidad</label>
                      <Input type="number" min={1} value={pkgQty} onChange={e => setPkgQty(e.target.value)}
                        className="rounded-lg bg-[#f5f7f9] border-[#dfe3e6] h-8 text-sm" />
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0 w-24">
                      <label className="text-[10px] font-medium text-[#595c5e]">Precio (USD)</label>
                      <Input type="number" step="0.01" placeholder="0.00" value={pkgPrice} onChange={e => setPkgPrice(e.target.value)}
                        className="rounded-lg bg-[#f5f7f9] border-[#dfe3e6] h-8 text-sm" />
                    </div>
                    <div className="flex flex-col gap-1 flex-1">
                      <label className="text-[10px] font-medium text-[#595c5e]">Nota</label>
                      <Input placeholder="ej. paquete extra acordado" value={pkgNote} onChange={e => setPkgNote(e.target.value)}
                        className="rounded-lg bg-[#f5f7f9] border-[#dfe3e6] h-8 text-sm" />
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <label className="text-[10px] text-transparent">add</label>
                      <button onClick={addCambiosPackage}
                        className="h-8 px-3 rounded-lg border border-[#00675c] text-[#00675c] text-xs font-semibold hover:bg-[#00675c]/5">
                        + Agregar
                      </button>
                    </div>
                  </div>

                  {/* Package list */}
                  <div className="space-y-1.5">
                    {cambiosPackages.map((pkg, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs px-3 py-2 bg-[#f5f7f9] rounded-lg border border-[#dfe3e6]">
                        <span className="flex-1 text-[#2c2f31]">
                          <strong>+{pkg.qty} cambios</strong>
                          {pkg.price_usd != null && ` · $${pkg.price_usd.toFixed(2)}`}
                          {pkg.note && ` · ${pkg.note}`}
                        </span>
                        <span className="text-[#abadaf]">{new Date(pkg.created_at).toLocaleDateString('es-SV', { day: 'numeric', month: 'short' })}</span>
                        <button onClick={() => setCambiosPackages(prev => prev.filter((_, j) => j !== i))}
                          className="text-[#b31b25] opacity-60 hover:opacity-100">
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
                        </button>
                      </div>
                    ))}
                    {cambiosPackages.length === 0 && (
                      <p className="text-xs text-[#abadaf] italic px-1">Sin paquetes extra este ciclo.</p>
                    )}
                  </div>
                </div>

                <div className="h-px bg-[#dfe3e6]" />

                {/* 2. Contenido extra vendido */}
                <div>
                  <p className="text-[11px] font-bold text-[#abadaf] uppercase tracking-wider mb-0.5">
                    Contenido extra vendido
                  </p>
                  <p className="text-[10px] text-[#747779] mb-3">
                    Cobros adicionales fuera del plan — fotografía, diseño, consultorías, etc.
                  </p>

                  {/* Mode toggle */}
                  <div className="flex gap-1 mb-3 bg-[#f5f7f9] rounded-lg border border-[#dfe3e6] p-0.5 w-fit">
                    <button
                      onClick={() => setExtraIsCustom(false)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                        !extraIsCustom ? 'bg-white text-[#2c2f31] shadow-sm' : 'text-[#747779]'
                      }`}
                    >
                      Estándar
                    </button>
                    <button
                      onClick={() => setExtraIsCustom(true)}
                      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                        extraIsCustom ? 'bg-white text-[#2c2f31] shadow-sm' : 'text-[#747779]'
                      }`}
                    >
                      Personalizado
                    </button>
                  </div>

                  {!extraIsCustom && (
                    <div className="flex gap-1.5 mb-3 flex-wrap">
                      {(Object.entries(EXTRA_CONTENT_PRICES) as [ContentType, number][]).map(([type, price]) => (
                        <span key={type} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#f5f7f9] border border-[#dfe3e6] text-[#595c5e]">
                          {CONTENT_TYPE_LABELS[type]} · ${price}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2 mb-2">
                    {extraIsCustom ? (
                      <>
                        <div className="flex flex-col gap-1 flex-1">
                          <label className="text-[10px] font-medium text-[#595c5e]">Descripción</label>
                          <Input placeholder="ej. Sesión fotográfica" value={extraLabel} onChange={e => setExtraLabel(e.target.value)}
                            className="rounded-lg bg-[#f5f7f9] border-[#dfe3e6] h-8 text-sm" />
                        </div>
                        <div className="flex flex-col gap-1 flex-shrink-0 w-24">
                          <label className="text-[10px] font-medium text-[#595c5e]">Precio/u (USD)</label>
                          <Input type="number" step="0.01" placeholder="0.00" value={extraPrice} onChange={e => setExtraPrice(e.target.value)}
                            className="rounded-lg bg-[#f5f7f9] border-[#dfe3e6] h-8 text-sm" />
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col gap-1 flex-1">
                        <label className="text-[10px] font-medium text-[#595c5e]">Tipo</label>
                        <select value={extraType} onChange={e => setExtraType(e.target.value as ContentType)}
                          className="h-8 px-2 rounded-lg border border-[#dfe3e6] bg-[#f5f7f9] text-xs text-[#2c2f31] focus:outline-none focus:border-[#00675c]">
                          {(Object.keys(EXTRA_CONTENT_PRICES) as ContentType[]).map(t => (
                            <option key={t} value={t}>{CONTENT_TYPE_LABELS[t]} · ${EXTRA_CONTENT_PRICES[t]}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="flex flex-col gap-1 flex-shrink-0 w-16">
                      <label className="text-[10px] font-medium text-[#595c5e]">Cant.</label>
                      <Input type="number" min={1} value={extraQty} onChange={e => setExtraQty(e.target.value)}
                        className="rounded-lg bg-[#f5f7f9] border-[#dfe3e6] h-8 text-sm" />
                    </div>
                    <div className="flex flex-col gap-1 flex-1">
                      <label className="text-[10px] font-medium text-[#595c5e]">Nota</label>
                      <Input placeholder="opcional" value={extraNote} onChange={e => setExtraNote(e.target.value)}
                        className="rounded-lg bg-[#f5f7f9] border-[#dfe3e6] h-8 text-sm" />
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <label className="text-[10px] text-transparent">add</label>
                      <button onClick={addExtraContent}
                        className="h-8 px-3 rounded-lg border border-[#00675c] text-[#00675c] text-xs font-semibold hover:bg-[#00675c]/5">
                        + Agregar
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    {extraContent.map((item, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs px-3 py-2 bg-[#f5f7f9] rounded-lg border border-[#dfe3e6]">
                        <span className="flex-1 text-[#2c2f31]">
                          {item.qty}× {item.label}
                          {item.note && ` · ${item.note}`}
                        </span>
                        <span className="font-semibold text-[#00675c]">${(item.price_per_unit * item.qty).toFixed(2)}</span>
                        <button onClick={() => setExtraContent(prev => prev.filter((_, j) => j !== i))}
                          className="text-[#b31b25] opacity-60 hover:opacity-100">
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
                        </button>
                      </div>
                    ))}
                    {extraContent.length === 0 && (
                      <p className="text-xs text-[#abadaf] italic px-1">Sin contenido extra este ciclo.</p>
                    )}
                  </div>

                  {extraContent.length > 0 && (
                    <p className="text-xs text-[#595c5e] mt-2 px-1">
                      Total facturado extra: <strong className="text-[#00675c]">${totalExtraRevenue.toFixed(2)}</strong>
                    </p>
                  )}
                </div>

                <div className="h-px bg-[#dfe3e6]" />

                {/* 3. Content overrides */}
                <div>
                  <p className="text-[11px] font-bold text-[#abadaf] uppercase tracking-wider mb-1">
                    Cantidades de contenido — override este ciclo
                  </p>
                  <p className="text-[10px] text-[#747779] mb-3">
                    Deja en blanco para usar el valor del plan. Solo aplica a este ciclo.
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {CONTENT_TYPES_DISPLAY.map((type) => {
                      const baseVal = limits?.[type] ?? 0
                      const overrideVal = contentOverride[type]
                      const isModified = overrideVal !== undefined && overrideVal !== baseVal
                      return (
                        <div key={type} className={`rounded-xl p-2.5 border ${isModified ? 'border-[#00675c]/30 bg-[#00675c]/04' : 'border-[#dfe3e6] bg-[#f5f7f9]'}`}
                          style={isModified ? { background: 'rgba(0,103,92,.04)' } : {}}>
                          <label className="text-[10px] font-medium text-[#595c5e] block mb-1">
                            {CONTENT_TYPE_LABELS[type]}
                          </label>
                          <p className="text-[9px] text-[#abadaf] mb-1.5">Base: {baseVal}</p>
                          <input
                            type="number" min={0}
                            placeholder={String(baseVal)}
                            value={overrideVal ?? ''}
                            onChange={e => {
                              const val = e.target.value === '' ? undefined : parseInt(e.target.value)
                              setContentOverride(prev => {
                                const next = { ...prev }
                                if (val === undefined) { delete next[type] }
                                else { next[type] = val }
                                return next
                              })
                            }}
                            className={`w-full h-7 px-2 rounded-lg text-xs font-bold border focus:outline-none ${
                              isModified
                                ? 'border-[#00675c]/40 bg-white text-[#00675c]'
                                : 'border-[#dfe3e6] bg-white text-[#2c2f31]'
                            }`}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>

                {cycleError && (
                  <p className="text-sm text-[#b31b25] bg-[#b31b25]/5 rounded-xl px-3 py-2 border border-[#b31b25]/20">
                    {cycleError}
                  </p>
                )}

                <Button onClick={handleSaveCycle} disabled={cycleLoading}
                  className="w-full rounded-xl text-white font-semibold"
                  style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}>
                  {cycleLoading ? 'Guardando...' : 'Guardar configuración del ciclo'}
                </Button>

              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
