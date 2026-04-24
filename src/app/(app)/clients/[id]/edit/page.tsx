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
import type { BillingPeriod, Client, Plan, BillingCycle, ContentType, CambiosPackage, ExtraContentItem, WeekKey, WeeklyDistribution, PersonType } from '@/types/db'
import { effectiveWeeklyTarget } from '@/lib/domain/requirement'
import { limitsToRecord, CONTENT_TYPE_LABELS, EXTRA_CONTENT_PRICES } from '@/lib/domain/plans'
import { augmentDistribution, buildProrateOverride, buildAccumulateOverride } from '@/lib/domain/weekly-distribution'
import { LogoUploader } from '@/components/clients/LogoUploader'

export default function ClientEditPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params.id

  const [isAdmin, setIsAdmin] = useState(false)
  const [isStrictAdmin, setIsStrictAdmin] = useState(false)
  const [client, setClient] = useState<Client | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [currentCycle, setCurrentCycle] = useState<BillingCycle | null>(null)
  const [loading, setLoading] = useState(false)
  const [cycleLoading, setCycleLoading] = useState(false)
  const [fiscalSaving, setFiscalSaving] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cycleError, setCycleError] = useState<string | null>(null)
  const [fiscalError, setFiscalError] = useState<string | null>(null)
  const [fiscalOk, setFiscalOk] = useState(false)

  const [weeklyTargets, setWeeklyTargets] = useState<Partial<Record<ContentType, number>>>({})
  const [weeklyDist, setWeeklyDist] = useState<WeeklyDistribution>({})
  const [activeWeekTab, setActiveWeekTab] = useState<WeekKey>('S1')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)

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

  const [fiscal, setFiscal] = useState({
    legal_name: '',
    person_type: '' as PersonType | '',
    nit: '',
    nrc: '',
    dui: '',
    fiscal_address: '',
    giro: '',
    country_code: 'SV',
    default_tax_rate: '0.13',
  })
  const [autoBilling, setAutoBilling] = useState(false)

  const [cambiosPackages, setCambiosPackages] = useState<CambiosPackage[]>([])
  const [extraContent, setExtraContent] = useState<ExtraContentItem[]>([])
  const [contentOverride, setContentOverride] = useState<Partial<Record<ContentType, number>>>({})
  type DistStrategy = { mode: 'prorate' } | { mode: 'accumulate'; week: WeekKey }
  const [distStrategy, setDistStrategy] = useState<Partial<Record<ContentType, DistStrategy>>>({})
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
      setIsStrictAdmin(appUser?.role === 'admin')
      if (!adminUser) { router.replace(`/clients/${id}`); return }

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
      setFiscal({
        legal_name:       clientData.legal_name ?? '',
        person_type:      clientData.person_type ?? '',
        nit:              clientData.nit ?? '',
        nrc:              clientData.nrc ?? '',
        dui:              clientData.dui ?? '',
        fiscal_address:   clientData.fiscal_address ?? '',
        giro:             clientData.giro ?? '',
        country_code:     clientData.country_code ?? 'SV',
        default_tax_rate: (clientData.default_tax_rate ?? 0.13).toString(),
      })
      setAutoBilling((clientData as Client & { auto_billing?: boolean }).auto_billing ?? false)
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

  function setFiscal2(key: keyof typeof fiscal, value: string) {
    setFiscal((prev) => ({ ...prev, [key]: value }))
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
    if (updateError) { setError('Error al guardar los cambios.'); setLoading(false); return }
    router.push(`/clients/${id}`)
    router.refresh()
  }

  async function handleSaveFiscal() {
    setFiscalSaving(true)
    setFiscalError(null)
    setFiscalOk(false)
    const supabase = createClient()
    const { error } = await supabase
      .from('clients')
      .update({
        legal_name:       fiscal.legal_name.trim() || null,
        person_type:      fiscal.person_type || null,
        nit:              fiscal.nit.trim() || null,
        nrc:              fiscal.nrc.trim() || null,
        dui:              fiscal.dui.trim() || null,
        fiscal_address:   fiscal.fiscal_address.trim() || null,
        giro:             fiscal.giro.trim() || null,
        country_code:     fiscal.country_code.trim() || 'SV',
        default_tax_rate: Number.isFinite(parseFloat(fiscal.default_tax_rate))
                            ? parseFloat(fiscal.default_tax_rate) : 0.13,
        auto_billing:     autoBilling,
      })
      .eq('id', id)
    setFiscalSaving(false)
    if (error) { setFiscalError('Error al guardar datos fiscales.'); return }
    setFiscalOk(true)
    setTimeout(() => setFiscalOk(false), 3000)
  }

  const baseDistForOverride = useMemo<WeeklyDistribution>(() => {
    if (!limits) return {}
    const base = Object.keys(weeklyDist).length > 0
      ? weeklyDist : selectedPlan?.default_weekly_distribution_json ?? {}
    const pipelineTypes = (Object.entries(limits) as [ContentType, number][])
      .filter(([t, v]) => v > 0 && !['produccion', 'reunion', 'matriz_contenido'].includes(t))
      .map(([t]) => t)
    return augmentDistribution(base, pipelineTypes, limits)
  }, [limits, weeklyDist, selectedPlan])

  const weeklyOverridePreview = useMemo<WeeklyDistribution | null>(() => {
    if (!limits) return null
    let result = baseDistForOverride
    let modified = false
    for (const [type, overrideVal] of Object.entries(contentOverride) as [ContentType, number][]) {
      const baseVal = limits[type] ?? 0
      const delta = overrideVal - baseVal
      if (delta === 0) continue
      const strategy = distStrategy[type] ?? { mode: 'prorate' }
      if (strategy.mode === 'prorate') {
        result = buildProrateOverride(result, { [type]: delta })
      } else {
        result = buildAccumulateOverride(result, { [type]: delta }, strategy.week)
      }
      modified = true
    }
    return modified ? result : null
  }, [limits, baseDistForOverride, contentOverride, distStrategy])

  async function handleSaveCycle() {
    if (!currentCycle) return
    setCycleLoading(true)
    setCycleError(null)
    const supabase = createClient()
    const budget = selectedPlan?.cambios_included ?? currentCycle.cambios_budget
    const { error } = await supabase
      .from('billing_cycles')
      .update({
        cambios_budget: budget,
        cambios_packages_json: cambiosPackages,
        extra_content_json: extraContent,
        content_limits_override_json: Object.keys(contentOverride).length > 0 ? contentOverride : null,
        weekly_distribution_override_json: weeklyOverridePreview,
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
      setExtraContent(prev => [...prev, { label, qty, price_per_unit: price, note: extraNote.trim() || null, created_at: new Date().toISOString() }])
      setExtraLabel(''); setExtraPrice(''); setExtraNote('')
    } else {
      const pricePerUnit = EXTRA_CONTENT_PRICES[extraType] ?? 0
      setExtraContent(prev => [...prev, { content_type: extraType, label: CONTENT_TYPE_LABELS[extraType], qty, price_per_unit: pricePerUnit, note: extraNote.trim() || null, created_at: new Date().toISOString() }])
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
        <div className="flex-1 flex items-center justify-center text-fm-on-surface-variant text-sm">Cargando...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Editar cliente" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex gap-6 items-start max-w-6xl">

          {/* ── Izquierda: datos del cliente ── */}
          <div className="flex-shrink-0 w-[440px]">
            <div className="flex items-center gap-2 text-sm text-fm-on-surface-variant mb-5">
              <Link href="/clients" className="hover:text-fm-primary transition-colors">Clientes</Link>
              <span>/</span>
              <Link href={`/clients/${id}`} className="hover:text-fm-primary transition-colors">{client?.name}</Link>
              <span>/</span>
              <span className="text-fm-on-surface font-medium">Editar</span>
            </div>

            <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-6">
              <h2 className="text-lg font-semibold text-fm-on-surface mb-5">Datos del cliente</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">

                  <div className="col-span-2 space-y-1.5">
                    <Label>Logo</Label>
                    <LogoUploader value={logoUrl} onChange={setLogoUrl} clientId={id} clientName={form.name || client?.name || ''} disabled={loading} />
                  </div>

                  <div className="col-span-2 space-y-1.5">
                    <Label>Nombre *</Label>
                    <Input required value={form.name} onChange={(e) => set('name', e.target.value)}
                      className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Plan *</Label>
                    <select required value={form.current_plan_id} onChange={(e) => { set('current_plan_id', e.target.value); setWeeklyTargets({}) }}
                      className="w-full py-2 px-3 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl text-fm-on-surface focus:outline-none focus:border-fm-primary">
                      {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — ${p.price_usd}</option>)}
                    </select>
                    <p className="text-xs text-fm-outline">El cambio aplica al siguiente ciclo.</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Día de facturación *</Label>
                    <Input required type="number" min={1} max={31} value={form.billing_day}
                      onChange={(e) => set('billing_day', e.target.value)}
                      className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Período de facturación</Label>
                    <select value={billingPeriod} onChange={(e) => setBillingPeriod(e.target.value as BillingPeriod)}
                      className="w-full py-2 px-3 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl text-fm-on-surface focus:outline-none focus:border-fm-primary">
                      <option value="monthly">Mensual</option>
                      <option value="biweekly">Quincenal</option>
                    </select>
                  </div>

                  {billingPeriod === 'biweekly' && (
                    <div className="space-y-1.5">
                      <Label>2° día de facturación</Label>
                      <Input required type="number" min={1} max={31} value={billingDay2}
                        onChange={(e) => setBillingDay2(e.target.value)} placeholder="ej. 15"
                        className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label>Correo de contacto</Label>
                    <Input type="email" value={form.contact_email} onChange={(e) => set('contact_email', e.target.value)}
                      placeholder="cliente@email.com" className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Teléfono</Label>
                    <Input value={form.contact_phone} onChange={(e) => set('contact_phone', e.target.value)}
                      placeholder="+503 7000 0000" className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                  </div>

                  <div className="col-span-2 pt-1">
                    <p className="text-xs font-semibold text-fm-outline-variant uppercase tracking-widest mb-3">
                      Redes sociales y contacto digital
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Instagram</Label>
                        <Input value={form.ig_handle} onChange={(e) => set('ig_handle', e.target.value)}
                          placeholder="@handle" className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Facebook</Label>
                        <Input value={form.fb_handle} onChange={(e) => set('fb_handle', e.target.value)}
                          placeholder="nombre de página o URL" className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>TikTok</Label>
                        <Input value={form.tiktok_handle} onChange={(e) => set('tiktok_handle', e.target.value)}
                          placeholder="@handle" className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>YouTube</Label>
                        <Input value={form.yt_handle} onChange={(e) => set('yt_handle', e.target.value)}
                          placeholder="@canal o nombre" className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>LinkedIn</Label>
                        <Input value={form.linkedin_handle} onChange={(e) => set('linkedin_handle', e.target.value)}
                          placeholder="nombre de empresa o URL" className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Sitio web</Label>
                        <Input value={form.website_url} onChange={(e) => set('website_url', e.target.value)}
                          placeholder="https://ejemplo.com" className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <Label>Otro <span className="text-fm-outline-variant font-normal">(WhatsApp, Threads, etc.)</span></Label>
                        <Input value={form.other_contact} onChange={(e) => set('other_contact', e.target.value)}
                          placeholder="descripción y enlace o handle" className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                      </div>
                    </div>
                  </div>

                  {limits && (
                    <div className="col-span-2 pt-1">
                      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                        <p className="text-xs font-semibold text-fm-outline-variant uppercase tracking-widest">
                          Distribución semanal <span className="normal-case font-normal text-fm-outline">(cuántas piezas por semana)</span>
                        </p>
                        {selectedPlan?.default_weekly_distribution_json && (
                          <button type="button" onClick={() => setWeeklyDist(selectedPlan.default_weekly_distribution_json!)}
                            className="text-xs text-fm-primary hover:underline">
                            Restaurar defaults del plan
                          </button>
                        )}
                      </div>
                      <div className="flex rounded-xl border border-fm-surface-container-high overflow-hidden mb-4 w-fit">
                        {(['S1','S2','S3','S4'] as WeekKey[]).map(w => (
                          <button key={w} type="button" onClick={() => setActiveWeekTab(w)}
                            className={`px-4 py-1.5 text-sm font-semibold transition-colors ${activeWeekTab === w ? 'bg-fm-primary text-white' : 'text-fm-on-surface-variant hover:bg-fm-background'}`}>
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
                              <Input type="number" min={0} placeholder="0"
                                value={weeklyDist[activeWeekTab]?.[type] ?? ''}
                                onChange={(e) => setWeeklyDist(prev => {
                                  const weekSlot = { ...(prev[activeWeekTab] ?? {}) }
                                  if (e.target.value === '') { delete weekSlot[type] }
                                  else { weekSlot[type] = Math.max(0, Number(e.target.value)) }
                                  return { ...prev, [activeWeekTab]: weekSlot }
                                })}
                                className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  <div className="col-span-2 space-y-1.5">
                    <Label>Notas internas</Label>
                    <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)}
                      placeholder="Detalles adicionales sobre el cliente..."
                      className="rounded-xl bg-fm-background border-fm-surface-container-high resize-none" rows={3} />
                  </div>
                </div>

                {error && (
                  <p className="text-sm text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">{error}</p>
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

          {/* ── Derecha: paneles admin ── */}
          {((isAdmin && currentCycle) || isStrictAdmin) && (
            <div className="flex-1 min-w-0 space-y-6">

              {/* Panel ciclo actual */}
              {isAdmin && currentCycle && (
                <>
                  <div className="h-[38px] flex items-center gap-2">
                    <span className="material-symbols-outlined text-fm-error text-lg">shield</span>
                    <span className="text-sm font-semibold text-fm-on-surface">Configuración del ciclo actual</span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-fm-error/8 text-fm-error border border-fm-error/15">Solo admin</span>
                  </div>

                  <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-error/15 p-6 space-y-6">

                    <div>
                      <p className="text-[11px] font-bold text-fm-outline-variant uppercase tracking-wider mb-3">Cambios del ciclo</p>
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        <div className="bg-fm-background rounded-xl p-3 border border-fm-surface-container-high">
                          <p className="text-[10px] text-fm-on-surface-variant mb-0.5">Incluidos en plan</p>
                          <p className="text-xl font-bold text-fm-on-surface">{selectedPlan?.cambios_included ?? currentCycle.cambios_budget}</p>
                        </div>
                        <div className="bg-fm-background rounded-xl p-3 border border-fm-surface-container-high">
                          <p className="text-[10px] text-fm-on-surface-variant mb-0.5">Paquetes extra</p>
                          <p className="text-xl font-bold text-fm-primary">+{cambiosPackages.reduce((s, p) => s + p.qty, 0)}</p>
                        </div>
                        <div className="rounded-xl p-3 border border-fm-primary/20" style={{ background: 'rgba(0,103,92,.06)' }}>
                          <p className="text-[10px] text-fm-on-surface-variant mb-0.5">Total disponible</p>
                          <p className="text-xl font-bold text-fm-primary">{totalCambiosBudget}</p>
                        </div>
                      </div>

                      <div className="flex gap-2 mb-2">
                        <div className="flex flex-col gap-1 flex-shrink-0 w-20">
                          <label className="text-[10px] font-medium text-fm-on-surface-variant">Cantidad</label>
                          <Input type="number" min={1} value={pkgQty} onChange={e => setPkgQty(e.target.value)}
                            className="rounded-lg bg-fm-background border-fm-surface-container-high h-8 text-sm" />
                        </div>
                        <div className="flex flex-col gap-1 flex-shrink-0 w-24">
                          <label className="text-[10px] font-medium text-fm-on-surface-variant">Precio (USD)</label>
                          <Input type="number" step="0.01" placeholder="0.00" value={pkgPrice} onChange={e => setPkgPrice(e.target.value)}
                            className="rounded-lg bg-fm-background border-fm-surface-container-high h-8 text-sm" />
                        </div>
                        <div className="flex flex-col gap-1 flex-1">
                          <label className="text-[10px] font-medium text-fm-on-surface-variant">Nota</label>
                          <Input placeholder="ej. paquete extra acordado" value={pkgNote} onChange={e => setPkgNote(e.target.value)}
                            className="rounded-lg bg-fm-background border-fm-surface-container-high h-8 text-sm" />
                        </div>
                        <div className="flex flex-col gap-1 flex-shrink-0">
                          <label className="text-[10px] text-transparent">add</label>
                          <button onClick={addCambiosPackage}
                            className="h-8 px-3 rounded-lg border border-fm-primary text-fm-primary text-xs font-semibold hover:bg-fm-primary/5">
                            + Agregar
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        {cambiosPackages.map((pkg, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs px-3 py-2 bg-fm-background rounded-lg border border-fm-surface-container-high">
                            <span className="flex-1 text-fm-on-surface">
                              <strong>+{pkg.qty} cambios</strong>
                              {pkg.price_usd != null && ` · $${pkg.price_usd.toFixed(2)}`}
                              {pkg.note && ` · ${pkg.note}`}
                            </span>
                            <span className="text-fm-outline-variant">{new Date(pkg.created_at).toLocaleDateString('es-SV', { day: 'numeric', month: 'short' })}</span>
                            <button onClick={() => setCambiosPackages(prev => prev.filter((_, j) => j !== i))}
                              className="text-fm-error opacity-60 hover:opacity-100">
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
                            </button>
                          </div>
                        ))}
                        {cambiosPackages.length === 0 && (
                          <p className="text-xs text-fm-outline-variant italic px-1">Sin paquetes extra este ciclo.</p>
                        )}
                      </div>
                    </div>

                    <div className="h-px bg-fm-surface-container-high" />

                    <div>
                      <p className="text-[11px] font-bold text-fm-outline-variant uppercase tracking-wider mb-0.5">Contenido extra vendido</p>
                      <p className="text-[10px] text-fm-outline mb-3">Cobros adicionales fuera del plan — fotografía, diseño, consultorías, etc.</p>

                      <div className="flex gap-1 mb-3 bg-fm-background rounded-lg border border-fm-surface-container-high p-0.5 w-fit">
                        <button onClick={() => setExtraIsCustom(false)}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${!extraIsCustom ? 'bg-fm-surface-container-lowest text-fm-on-surface shadow-sm' : 'text-fm-outline'}`}>
                          Estándar
                        </button>
                        <button onClick={() => setExtraIsCustom(true)}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${extraIsCustom ? 'bg-fm-surface-container-lowest text-fm-on-surface shadow-sm' : 'text-fm-outline'}`}>
                          Personalizado
                        </button>
                      </div>

                      {!extraIsCustom && (
                        <div className="flex gap-1.5 mb-3 flex-wrap">
                          {(Object.entries(EXTRA_CONTENT_PRICES) as [ContentType, number][]).map(([type, price]) => (
                            <span key={type} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-fm-background border border-fm-surface-container-high text-fm-on-surface-variant">
                              {CONTENT_TYPE_LABELS[type]} · ${price}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex gap-2 mb-2">
                        {extraIsCustom ? (
                          <>
                            <div className="flex flex-col gap-1 flex-1">
                              <label className="text-[10px] font-medium text-fm-on-surface-variant">Descripción</label>
                              <Input placeholder="ej. Sesión fotográfica" value={extraLabel} onChange={e => setExtraLabel(e.target.value)}
                                className="rounded-lg bg-fm-background border-fm-surface-container-high h-8 text-sm" />
                            </div>
                            <div className="flex flex-col gap-1 flex-shrink-0 w-24">
                              <label className="text-[10px] font-medium text-fm-on-surface-variant">Precio/u (USD)</label>
                              <Input type="number" step="0.01" placeholder="0.00" value={extraPrice} onChange={e => setExtraPrice(e.target.value)}
                                className="rounded-lg bg-fm-background border-fm-surface-container-high h-8 text-sm" />
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col gap-1 flex-1">
                            <label className="text-[10px] font-medium text-fm-on-surface-variant">Tipo</label>
                            <select value={extraType} onChange={e => setExtraType(e.target.value as ContentType)}
                              className="h-8 px-2 rounded-lg border border-fm-surface-container-high bg-fm-background text-xs text-fm-on-surface focus:outline-none focus:border-fm-primary">
                              {(Object.keys(EXTRA_CONTENT_PRICES) as ContentType[]).map(t => (
                                <option key={t} value={t}>{CONTENT_TYPE_LABELS[t]} · ${EXTRA_CONTENT_PRICES[t]}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="flex flex-col gap-1 flex-shrink-0 w-16">
                          <label className="text-[10px] font-medium text-fm-on-surface-variant">Cant.</label>
                          <Input type="number" min={1} value={extraQty} onChange={e => setExtraQty(e.target.value)}
                            className="rounded-lg bg-fm-background border-fm-surface-container-high h-8 text-sm" />
                        </div>
                        <div className="flex flex-col gap-1 flex-1">
                          <label className="text-[10px] font-medium text-fm-on-surface-variant">Nota</label>
                          <Input placeholder="opcional" value={extraNote} onChange={e => setExtraNote(e.target.value)}
                            className="rounded-lg bg-fm-background border-fm-surface-container-high h-8 text-sm" />
                        </div>
                        <div className="flex flex-col gap-1 flex-shrink-0">
                          <label className="text-[10px] text-transparent">add</label>
                          <button onClick={addExtraContent}
                            className="h-8 px-3 rounded-lg border border-fm-primary text-fm-primary text-xs font-semibold hover:bg-fm-primary/5">
                            + Agregar
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        {extraContent.map((item, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs px-3 py-2 bg-fm-background rounded-lg border border-fm-surface-container-high">
                            <span className="flex-1 text-fm-on-surface">{item.qty}× {item.label}{item.note && ` · ${item.note}`}</span>
                            <span className="font-semibold text-fm-primary">${(item.price_per_unit * item.qty).toFixed(2)}</span>
                            <button onClick={() => setExtraContent(prev => prev.filter((_, j) => j !== i))}
                              className="text-fm-error opacity-60 hover:opacity-100">
                              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
                            </button>
                          </div>
                        ))}
                        {extraContent.length === 0 && <p className="text-xs text-fm-outline-variant italic px-1">Sin contenido extra este ciclo.</p>}
                      </div>
                      {extraContent.length > 0 && (
                        <p className="text-xs text-fm-on-surface-variant mt-2 px-1">
                          Total facturado extra: <strong className="text-fm-primary">${totalExtraRevenue.toFixed(2)}</strong>
                        </p>
                      )}
                    </div>

                    <div className="h-px bg-fm-surface-container-high" />

                    <div>
                      <p className="text-[11px] font-bold text-fm-outline-variant uppercase tracking-wider mb-1">
                        Cantidades de contenido — override este ciclo
                      </p>
                      <p className="text-[10px] text-fm-outline mb-3">Deja en blanco para usar el valor del plan. Solo aplica a este ciclo.</p>
                      <div className="grid grid-cols-4 gap-2">
                        {CONTENT_TYPES_DISPLAY.map((type) => {
                          const baseVal = limits?.[type] ?? 0
                          const overrideVal = contentOverride[type]
                          const isModified = overrideVal !== undefined && overrideVal !== baseVal
                          return (
                            <div key={type}
                              className={`rounded-xl p-2.5 border ${isModified ? 'border-fm-primary/30' : 'border-fm-surface-container-high bg-fm-background'}`}
                              style={isModified ? { background: 'rgba(0,103,92,.04)' } : {}}>
                              <label className="text-[10px] font-medium text-fm-on-surface-variant block mb-1">{CONTENT_TYPE_LABELS[type]}</label>
                              <p className="text-[9px] text-fm-outline-variant mb-1.5">Base: {baseVal}</p>
                              <input type="number" min={0} placeholder={String(baseVal)} value={overrideVal ?? ''}
                                onChange={e => {
                                  const val = e.target.value === '' ? undefined : parseInt(e.target.value)
                                  setContentOverride(prev => {
                                    const next = { ...prev }
                                    if (val === undefined) { delete next[type] } else { next[type] = val }
                                    return next
                                  })
                                }}
                                className={`w-full h-7 px-2 rounded-lg text-xs font-bold border focus:outline-none ${isModified ? 'border-fm-primary/40 bg-fm-surface-container-lowest text-fm-primary' : 'border-fm-surface-container-high bg-fm-surface-container-lowest text-fm-on-surface'}`}
                              />
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {(() => {
                      const modifiedTypes = (Object.entries(contentOverride) as [ContentType, number][])
                        .filter(([type, val]) => val !== undefined && val !== (limits?.[type] ?? 0))
                        .map(([type, val]) => ({ type, delta: val - (limits?.[type] ?? 0) }))
                      if (modifiedTypes.length === 0) return null
                      return (
                        <div>
                          <div className="h-px bg-fm-surface-container-high mb-5" />
                          <p className="text-[11px] font-bold text-fm-outline-variant uppercase tracking-wider mb-1">Distribución semanal del cambio</p>
                          <p className="text-[10px] text-fm-outline mb-3">Para cada tipo modificado, elige cómo repartir la diferencia entre las 4 semanas.</p>
                          <div className="space-y-3">
                            {modifiedTypes.map(({ type, delta }) => {
                              const strategy = distStrategy[type] ?? { mode: 'prorate' as const }
                              return (
                                <div key={type} className="rounded-xl border border-fm-primary/20 p-3" style={{ background: 'rgba(0,103,92,.04)' }}>
                                  <p className="text-xs font-semibold text-fm-primary mb-2">{CONTENT_TYPE_LABELS[type]} — {delta > 0 ? `+${delta}` : delta}</p>
                                  <div className="flex flex-wrap items-center gap-3 text-xs mb-2">
                                    <label className="flex items-center gap-1.5 text-fm-on-surface">
                                      <input type="radio" checked={strategy.mode === 'prorate'}
                                        onChange={() => setDistStrategy(prev => ({ ...prev, [type]: { mode: 'prorate' } }))} />
                                      Prorratear
                                    </label>
                                    <label className="flex items-center gap-1.5 text-fm-on-surface">
                                      <input type="radio" checked={strategy.mode === 'accumulate'}
                                        onChange={() => setDistStrategy(prev => ({ ...prev, [type]: { mode: 'accumulate', week: 'S1' } }))} />
                                      Acumular en
                                    </label>
                                    {strategy.mode === 'accumulate' && (
                                      <select value={strategy.week}
                                        onChange={e => setDistStrategy(prev => ({ ...prev, [type]: { mode: 'accumulate', week: e.target.value as WeekKey } }))}
                                        className="h-7 px-2 rounded-lg border border-fm-surface-container-high bg-fm-surface-container-lowest text-xs">
                                        {(['S1', 'S2', 'S3', 'S4'] as WeekKey[]).map(w => <option key={w} value={w}>{w}</option>)}
                                      </select>
                                    )}
                                  </div>
                                  {weeklyOverridePreview && (
                                    <p className="text-[11px] text-fm-on-surface-variant">
                                      Preview:{' '}
                                      {(['S1', 'S2', 'S3', 'S4'] as WeekKey[]).map(w => (
                                        <span key={w} className="mr-2">
                                          <strong className="text-fm-on-surface">{w}</strong>=<strong className="text-fm-primary">{weeklyOverridePreview[w]?.[type] ?? 0}</strong>
                                        </span>
                                      ))}
                                    </p>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })()}

                    {cycleError && (
                      <p className="text-sm text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">{cycleError}</p>
                    )}

                    <Button onClick={handleSaveCycle} disabled={cycleLoading}
                      className="w-full rounded-xl text-white font-semibold"
                      style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}>
                      {cycleLoading ? 'Guardando...' : 'Guardar configuración del ciclo'}
                    </Button>
                  </div>
                </>
              )}

              {/* ── Datos fiscales (solo admin estricto) ── */}
              {isStrictAdmin && (
                <div>
                  <div className="h-[38px] flex items-center gap-2">
                    <span className="material-symbols-outlined text-fm-error text-lg">receipt_long</span>
                    <span className="text-sm font-semibold text-fm-on-surface">Datos fiscales del cliente</span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-fm-error/8 text-fm-error border border-fm-error/15">Solo admin</span>
                  </div>

                  <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-error/15 p-6">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2 space-y-1.5">
                        <Label>Razón social</Label>
                        <Input value={fiscal.legal_name} onChange={(e) => setFiscal2('legal_name', e.target.value)}
                          placeholder="ej. EMPRESA EJEMPLO, S.A. DE C.V."
                          className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Tipo de persona</Label>
                        <select value={fiscal.person_type} onChange={(e) => setFiscal2('person_type', e.target.value as PersonType)}
                          className="w-full py-2 px-3 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl text-fm-on-surface focus:outline-none focus:border-fm-primary">
                          <option value="">—</option>
                          <option value="natural">Natural</option>
                          <option value="juridical">Jurídica</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>País</Label>
                        <Input value={fiscal.country_code} onChange={(e) => setFiscal2('country_code', e.target.value.toUpperCase())}
                          placeholder="SV" maxLength={2} className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>NIT</Label>
                        <Input value={fiscal.nit} onChange={(e) => setFiscal2('nit', e.target.value)}
                          placeholder="0000-000000-000-0" className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>NRC (registro IVA)</Label>
                        <Input value={fiscal.nrc} onChange={(e) => setFiscal2('nrc', e.target.value)}
                          placeholder="000000-0" className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <Label>DUI {fiscal.person_type === 'juridical' ? '(no aplica)' : ''}</Label>
                        <Input value={fiscal.dui} onChange={(e) => setFiscal2('dui', e.target.value)}
                          disabled={fiscal.person_type === 'juridical'}
                          placeholder="00000000-0" className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <Label>Dirección fiscal</Label>
                        <Textarea value={fiscal.fiscal_address} onChange={(e) => setFiscal2('fiscal_address', e.target.value)}
                          rows={2} placeholder="Dirección registrada ante Hacienda"
                          className="rounded-xl bg-fm-background border-fm-surface-container-high resize-none" />
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <Label>Giro (actividad económica)</Label>
                        <Input value={fiscal.giro} onChange={(e) => setFiscal2('giro', e.target.value)}
                          placeholder="ej. Publicidad, Comercio, Servicios"
                          className="rounded-xl bg-fm-background border-fm-surface-container-high" />
                      </div>
                      <div className="col-span-2">
                        <label className="flex items-center gap-2 text-sm text-fm-on-surface cursor-pointer">
                          <input type="checkbox" checked={parseFloat(fiscal.default_tax_rate) === 0}
                            onChange={(e) => setFiscal2('default_tax_rate', e.target.checked ? '0' : '0.13')} />
                          Cliente del exterior (IVA 0%)
                        </label>
                        <p className="text-xs text-fm-outline-variant mt-1">
                          IVA actual: <strong>{(parseFloat(fiscal.default_tax_rate) * 100).toFixed(0)}%</strong>
                        </p>
                      </div>
                      <div className="col-span-2 pt-2 border-t border-fm-surface-container-high">
                        <label className="flex items-center gap-2 text-sm text-fm-on-surface cursor-pointer">
                          <input type="checkbox" checked={autoBilling}
                            onChange={(e) => setAutoBilling(e.target.checked)} />
                          Facturación automática
                        </label>
                        <p className="text-xs text-fm-outline-variant mt-1">
                          Genera la factura del siguiente ciclo automáticamente 10 días antes del cierre del ciclo actual.
                        </p>
                      </div>
                    </div>

                    {fiscalError && (
                      <p className="mt-4 text-sm text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">{fiscalError}</p>
                    )}
                    {fiscalOk && (
                      <p className="mt-4 text-sm text-fm-primary bg-fm-primary/5 rounded-xl px-3 py-2 border border-fm-primary/20">
                        Datos fiscales guardados correctamente.
                      </p>
                    )}

                    <Button type="button" onClick={handleSaveFiscal} disabled={fiscalSaving}
                      className="mt-5 w-full rounded-xl text-white font-semibold"
                      style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}>
                      {fiscalSaving ? 'Guardando...' : 'Guardar datos fiscales'}
                    </Button>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>
      </div>
    </div>
  )
}
