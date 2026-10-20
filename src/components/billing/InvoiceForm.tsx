'use client'

import { useMemo, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { ClientSearchSelect } from '@/components/ui/ClientSearchSelect'
import { createClient } from '@/lib/supabase/client'
import { calculateTotals, formatCurrency, suggestItemsFromPlan, STANDARD_CAMBIOS_PACKAGES, type LineItemInput } from '@/lib/domain/invoices'
import { invoicePeriodLabel } from '@/lib/domain/billing'
import { nextCycleDates } from '@/lib/domain/cycles'
import { EXTRA_CONTENT_PRICES, CONTENT_TYPE_LABELS, formatPlanDescription } from '@/lib/domain/plans'
import { createInvoice, ensureScheduledCycle } from '@/app/actions/invoices'
import { createQuote } from '@/app/actions/quotes'
import { LineItemsEditor } from './LineItemsEditor'
import type { Client, Plan, BillingCycle, CambiosPackage, ContentType, ExtraContentItem, InvoiceExtrasMetadata, Invoice, PaymentProvider, TermAndCondition } from '@/types/db'

interface CatalogItem {
  label: string
  description: string
  unit_price: number
  quantity: number
  /** Si está presente, marca la factura como paquete extra (cambios o contenido) → genera créditos al pagar. */
  extrasMetadata?: InvoiceExtrasMetadata
}

type Mode = 'invoice' | 'quote'

interface BillingFormProps {
  mode: Mode
  initialClientId?: string
  initialCycleId?: string
}

export function InvoiceForm({ mode, initialClientId, initialCycleId }: BillingFormProps) {
  const router = useRouter()

  const [clients, setClients] = useState<Client[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [cycle, setCycle] = useState<BillingCycle | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // En modo cotización el usuario puede elegir entre "cliente existente" o
  // "prospecto" (sin cliente; opcionalmente captura un nombre para identificarla).
  const [clientMode, setClientMode] = useState<'existing' | 'prospect'>('existing')
  const [manualName, setManualName] = useState('')

  const [clientId, setClientId] = useState(initialClientId ?? '')
  const [cycleId, setCycleId] = useState(initialCycleId ?? '')
  const [items, setItems] = useState<LineItemInput[]>([{ description: '', quantity: 1, unit_price: 0 }])
  const [taxRate, setTaxRate] = useState(0.13)
  const [retentionRate, setRetentionRate] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [biweeklyHalf, setBiweeklyHalf] = useState<'first' | 'second' | null>(null)
  const [isFirstInvoice, setIsFirstInvoice] = useState(false)
  const [nextPeriod, setNextPeriod] = useState<{ periodStart: string; periodEnd: string } | null>(null)
  const [paymentProvider, setPaymentProvider] = useState<PaymentProvider>('manual')
  /** Metadata de paquete extra; se establece al agregar un item del catálogo de extras. Solo una factura puede ser un paquete (no se mezclan con plan). */
  const [extrasMetadata, setExtrasMetadata] = useState<InvoiceExtrasMetadata | null>(null)

  // Términos y condiciones editables por documento
  const [terms, setTerms] = useState<TermAndCondition[]>([])
  const [termsOpen, setTermsOpen] = useState(false)
  const [termsEditingId, setTermsEditingId] = useState<string | null>(null)
  const [termsEditingText, setTermsEditingText] = useState('')

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const [{ data: cs }, { data: ps }, { data: settings }] = await Promise.all([
        supabase.from('clients').select('*').order('name'),
        supabase.from('plans').select('*').eq('active', true),
        supabase.from('company_settings').select('terms_and_conditions_json').limit(1).maybeSingle(),
      ])
      setClients((cs ?? []) as Client[])
      setPlans((ps ?? []) as Plan[])
      setTerms((settings?.terms_and_conditions_json ?? []) as TermAndCondition[])
      setLoading(false)
    }
    load()
  }, [])

  // Precarga plan + IVA + retención + ciclo al seleccionar cliente
  useEffect(() => {
    if (!clientId || loading) return
    const client = clients.find(c => c.id === clientId)
    if (!client) return
    setTaxRate(client.default_tax_rate ?? 0.13)
    setRetentionRate(client.aplica_renta_retenida ? 0.1 : 0)

    const supabase = createClient()
    Promise.all([
      supabase
        .from('billing_cycles')
        .select('*')
        .eq('client_id', clientId)
        .eq('status', 'current')
        .maybeSingle(),
      supabase
        .from('invoices')
        .select('id, status, biweekly_half, billing_cycle_id')
        .eq('client_id', clientId),
    ]).then(([{ data: cycData }, { data: invData }]) => {
        const cyc = cycData as BillingCycle | null
        setCycle(cyc)

        const existingInvoices = (invData ?? []) as Pick<Invoice, 'id' | 'status' | 'biweekly_half' | 'billing_cycle_id'>[]
        const nonVoid = existingInvoices.filter((inv) => inv.status !== 'void')
        // "Primera factura": cliente recién creado, sin facturas previas (ni borradores no anulados).
        const firstTime = nonVoid.length === 0
        setIsFirstInvoice(firstTime)

        const plan = plans.find(p => p.id === client.current_plan_id)
        const isContentPlan = (plan?.unified_content_limit ?? null) != null

        // Pre-computar período del siguiente ciclo para el selector/label.
        // No aplica a planes de contenido (no tienen ciclo recurrente).
        const np = cyc && !isContentPlan
          ? nextCycleDates(cyc.period_end, { billingPeriod: client.billing_period })
          : null
        setNextPeriod(np)

        // Default:
        //   - Plan de contenido → siempre vincular al ciclo de contenido vigente (no ad-hoc, no "next").
        //   - Sin ciclo → ad-hoc ('').
        //   - Primera factura → ciclo actual (el cliente paga el ciclo en curso por primera vez).
        //   - Recurrente → siguiente ciclo (pago anticipado).
        const defaultCycleId = !cyc
          ? ''
          : isContentPlan
            ? ''
            : firstTime
              ? cyc.id
              : 'next'
        if (mode === 'invoice' && !initialCycleId) {
          setCycleId(defaultCycleId)
        }

        // Resetear selector de quincena según billing_period y si hay ciclo (no en ad-hoc).
        if (client.billing_period === 'biweekly' && (initialCycleId || defaultCycleId)) {
          // Si el ciclo destino es el actual y ya está la primera quincena pagada
          // (o existe factura 'first' no anulada), sugerimos 'second'. De lo contrario, 'first'.
          const targetCycleId = defaultCycleId === 'next' ? null : defaultCycleId
          const hasFirstForCycle = targetCycleId
            ? nonVoid.some(i => i.billing_cycle_id === targetCycleId && i.biweekly_half === 'first')
            : false
          const firstAlreadyPaid = cyc && targetCycleId === cyc.id && cyc.payment_status === 'paid'
          setBiweeklyHalf(hasFirstForCycle || firstAlreadyPaid ? 'second' : 'first')
        } else {
          setBiweeklyHalf(null)
        }

        // Sugerir ítem del plan. Reemplaza la línea si está vacía o si era un auto-precargado
        // de un plan anterior (al cambiar de cliente). Respeta líneas editadas manualmente.
        if (plan && items.length === 1) {
          const desc = items[0].description
          const isEmptyDefault = !desc && items[0].unit_price === 0
          const isAutoPreloaded = desc.startsWith('Plan ')
          if (isEmptyDefault || isAutoPreloaded) {
            let label: string | undefined
            if (isContentPlan) {
              // Plan de contenido: solo nombre del plan, sin sufijo de fecha.
              // La factura es ad-hoc; "Paquete activo desde" en /clients/[id] usa cycle.period_start.
              label = undefined
            } else {
              // Si es primera factura → usa el ciclo actual; si recurrente → el siguiente.
              const targetPeriod = firstTime && cyc
                ? { periodStart: cyc.period_start, periodEnd: cyc.period_end }
                : np
              const half: 'first' | 'second' | null =
                client.billing_period === 'biweekly' ? 'first' : null
              label = targetPeriod
                ? invoicePeriodLabel(targetPeriod.periodStart, targetPeriod.periodEnd, client.billing_period, half)
                : undefined
            }
            const half: 'first' | 'second' | null =
              !isContentPlan && client.billing_period === 'biweekly' ? 'first' : null
            setItems(suggestItemsFromPlan(plan, label, half))
          }
        }
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, loading])

  // Re-calcular label del item precargado cuando el usuario cambia la quincena o el ciclo destino
  useEffect(() => {
    const client = clients.find((c) => c.id === clientId)
    if (!client) return
    if (items.length !== 1) return
    const plan = plans.find((p) => p.id === client.current_plan_id)
    if (!plan) return
    // Planes de contenido: el label se fija a partir del period_start del ciclo en la primera carga.
    // No re-aplicar aquí (no hay biweekly ni "next" para estos planes).
    if (plan.unified_content_limit != null) return
    // Solo re-aplicamos si la línea sigue siendo el item auto-precargado del plan.
    if (!items[0].description.startsWith(`Plan ${plan.name}`)) return

    // Elegir el período según selección:
    //   'next'      → siguiente ciclo
    //   cycle.id    → ciclo actual
    //   ''          → ad-hoc, sin período en el label
    let targetPeriod: { periodStart: string; periodEnd: string } | null = null
    if (cycleId === 'next' && cycle) {
      targetPeriod = nextCycleDates(cycle.period_end, { billingPeriod: client.billing_period })
    } else if (cycle && cycleId === cycle.id) {
      targetPeriod = { periodStart: cycle.period_start, periodEnd: cycle.period_end }
    }

    const half: 'first' | 'second' | null =
      client.billing_period === 'biweekly' ? biweeklyHalf : null
    const label = targetPeriod
      ? invoicePeriodLabel(targetPeriod.periodStart, targetPeriod.periodEnd, client.billing_period, half)
      : undefined
    setItems(suggestItemsFromPlan(plan, label, half))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biweeklyHalf, cycleId])

  const totals = useMemo(
    () => calculateTotals({ items, tax_rate: taxRate, discount_amount: discount, retention_rate: retentionRate }),
    [items, taxRate, discount, retentionRate]
  )

  const selectedClient = useMemo(() => clients.find(c => c.id === clientId), [clients, clientId])
  const selectedPlan = useMemo(
    () => plans.find(p => p.id === selectedClient?.current_plan_id),
    [plans, selectedClient]
  )
  const isContentPlan = (selectedPlan?.unified_content_limit ?? null) != null

  // Catálogo de ítems predefinidos
  const catalog = useMemo<{ group: string; items: CatalogItem[] }[]>(() => {
    const groups: { group: string; items: CatalogItem[] }[] = []

    // Solo en cotizaciones: planes disponibles como ítems de línea.
    // No llevan extrasMetadata (no generan créditos al pagar; son solo texto descriptivo).
    if (mode === 'quote' && plans.length > 0) {
      groups.push({
        group: 'Planes',
        items: plans.map((p) => {
          const planDesc = formatPlanDescription(p)
          return {
            label: p.name,
            description: planDesc ? `${p.name} — ${planDesc}` : p.name,
            unit_price: p.price_usd,
            quantity: 1,
          }
        }),
      })
    }

    // Paquete on-demand: mismo tamaño y precio que el plan on-demand (cupo compartido sin vencimiento).
    // Al pagar la factura se materializa como saldo `content_pool` que cubre cualquier tipo tippable
    // cuando el cliente agota el cupo de su plan mensual. Un grupo por plan on-demand activo.
    const onDemandPlans = plans.filter((p) => p.unified_content_limit != null && p.no_expira)
    if (onDemandPlans.length > 0) {
      groups.push({
        group: 'Paquete on-demand',
        items: onDemandPlans.map((p) => {
          const qty = p.unified_content_limit as number
          return {
            label: `Paquete on-demand — ${p.name} (${qty} contenidos)`,
            description: `Paquete on-demand: ${qty} contenidos de cualquier tipo (estático, video corto, reel o short), sin vencimiento`,
            unit_price: p.price_usd,
            quantity: 1,
            extrasMetadata: { kind: 'content_pool' as const, qty },
          }
        }),
      })
    }

    // Contenido extra estándar — cada item del catálogo lleva su `extrasMetadata`
    // para que al pagar la factura se materialice como crédito de contenido.
    const contentItems: CatalogItem[] = (Object.entries(EXTRA_CONTENT_PRICES) as [keyof typeof EXTRA_CONTENT_PRICES, number][])
      .map(([type, price]) => ({
        label: CONTENT_TYPE_LABELS[type],
        description: `${CONTENT_TYPE_LABELS[type]} adicional`,
        unit_price: price,
        quantity: 1,
        extrasMetadata: { kind: 'content' as const, content_type: type as ContentType, qty: 1 },
      }))
    if (contentItems.length) groups.push({ group: 'Contenido extra', items: contentItems })

    {
      // Paquetes de cambios: estándar + personalizados del ciclo.
      // El paquete estándar de 5 cambios tiene quantity=1 (1 línea $25 total) y
      // extrasMetadata.qty=5 (cantidad real de cambios → se convierten en créditos).
      const cambiosPkgs = (cycle?.cambios_packages_json ?? []) as CambiosPackage[]
      const cycleItems: CatalogItem[] = cambiosPkgs
        .filter(p => p.price_usd && p.price_usd > 0)
        .map((p) => ({
          label: `Cambios extra${p.note ? ` — ${p.note}` : ''} (${p.qty})`,
          description: `Paquete de cambios adicionales${p.note ? ` — ${p.note}` : ''} (${p.qty} cambios)`,
          unit_price: p.price_usd ?? 0,
          quantity: 1,
          extrasMetadata: { kind: 'cambios' as const, qty: p.qty },
        }))

      const standardCambios: CatalogItem[] = STANDARD_CAMBIOS_PACKAGES.map((p) => ({
        ...p,
        extrasMetadata: { kind: 'cambios' as const, qty: 5 },
      }))

      const allCambios: CatalogItem[] = [
        ...standardCambios,
        ...cycleItems,
      ]
      groups.push({ group: 'Paquetes de cambios', items: allCambios })
    }

    if (cycle) {

      // Contenido extra registrado en el ciclo
      const extraContent = (cycle.extra_content_json ?? []) as ExtraContentItem[]
      if (extraContent.length) {
        groups.push({
          group: 'Contenido del ciclo',
          items: extraContent.map(ec => ({
            label: ec.label,
            description: ec.label,
            unit_price: ec.price_per_unit,
            quantity: ec.qty,
          })),
        })
      }
    }

    return groups
  }, [cycle, mode, plans])

  const [catalogOpen, setCatalogOpen] = useState(false)

  // — helpers para T&C —
  function addTerm() {
    const newTerm: TermAndCondition = {
      id: crypto.randomUUID(),
      order: terms.length + 1,
      text: '',
    }
    setTerms(prev => [...prev, newTerm])
    setTermsEditingId(newTerm.id)
    setTermsEditingText('')
  }

  function saveTermEdit(id: string) {
    setTerms(prev => prev.map(t => t.id === id ? { ...t, text: termsEditingText } : t))
    setTermsEditingId(null)
    setTermsEditingText('')
  }

  function cancelTermEdit(id: string) {
    // Si el texto original estaba vacío y no se escribió nada, eliminar
    const original = terms.find(t => t.id === id)
    if (original && !original.text.trim() && !termsEditingText.trim()) {
      setTerms(prev => prev.filter(t => t.id !== id))
    }
    setTermsEditingId(null)
    setTermsEditingText('')
  }

  function deleteTerm(id: string) {
    setTerms(prev => prev.filter(t => t.id !== id).map((t, i) => ({ ...t, order: i + 1 })))
  }

  function moveTerm(id: string, direction: 'up' | 'down') {
    setTerms(prev => {
      const idx = prev.findIndex(t => t.id === id)
      if (idx === -1) return prev
      const next = [...prev]
      const swap = direction === 'up' ? idx - 1 : idx + 1
      if (swap < 0 || swap >= next.length) return prev
      ;[next[idx], next[swap]] = [next[swap], next[idx]]
      return next.map((t, i) => ({ ...t, order: i + 1 }))
    })
  }

  function addFromCatalog(item: CatalogItem) {
    if (item.extrasMetadata) {
      // Una factura solo puede materializar UN paquete extra (la última que se agrega gana).
      setExtrasMetadata(item.extrasMetadata)
    }
    setItems(prev => {
      // Si ya existe una línea con la misma descripción, incrementa cantidad
      const existing = prev.findIndex(it => it.description === item.description)
      if (existing !== -1) {
        return prev.map((it, i) =>
          i === existing ? { ...it, quantity: it.quantity + item.quantity } : it
        )
      }
      // Si la única línea está vacía, reemplázala
      if (prev.length === 1 && !prev[0].description && prev[0].unit_price === 0) {
        return [{ description: item.description, quantity: item.quantity, unit_price: item.unit_price }]
      }
      return [...prev, { description: item.description, quantity: item.quantity, unit_price: item.unit_price }]
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const isProspectQuote = mode === 'quote' && clientMode === 'prospect'
    if (!isProspectQuote && !clientId) { setError('Seleccione un cliente'); return }
    const validItems = items.filter(it => it.description.trim() && (it.quantity > 0) && (it.unit_price >= 0))
    if (validItems.length === 0) { setError('Agregue al menos una línea válida'); return }

    setSaving(true)

    // Resolver cycleId:
    //   'next' → crear/reusar un billing_cycle con status='scheduled' para este cliente.
    //   ''     → ad-hoc, sin ciclo.
    //   UUID   → ciclo actual (se usa directo).
    let resolvedCycleId: string | null = cycleId || null
    if (mode === 'invoice' && cycleId === 'next') {
      const r = await ensureScheduledCycle(clientId)
      if ('error' in r) { setError(r.error); setSaving(false); return }
      resolvedCycleId = r.cycleId
    }

    const result = mode === 'invoice'
      ? await createInvoice({
          clientId,
          billingCycleId: resolvedCycleId,
          items: validItems,
          taxRate,
          discountAmount: discount,
          retentionRate,
          dueDate: dueDate || null,
          notes: notes || null,
          biweeklyHalf: cycleId && selectedClient?.billing_period === 'biweekly' ? biweeklyHalf : null,
          paymentProvider,
          extrasMetadata,
          termsSnapshotJson: terms.length > 0 ? terms : null,
        })
      : await createQuote({
          clientId: isProspectQuote ? null : clientId,
          manualClient: isProspectQuote
            ? { name: manualName.trim() || 'Sin cliente' }
            : undefined,
          items: validItems,
          taxRate,
          discountAmount: discount,
          retentionRate,
          validUntil: validUntil || null,
          notes: notes || null,
          termsSnapshotJson: terms.length > 0 ? terms : null,
        })

    setSaving(false)
    if ('error' in result) { setError(result.error); return }

    if ('invoiceId' in result) {
      router.push(`/billing/invoices/${result.invoiceId}`)
    } else {
      router.push(`/billing/quotes/${result.quoteId}`)
    }
    router.refresh()
  }

  if (loading) {
    return <div className="text-sm text-fm-on-surface-variant p-6">Cargando…</div>
  }

  const titleLabel = mode === 'invoice' ? 'Nueva factura' : 'Nueva cotización'

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-[1fr_340px] gap-6">
      {/* Izquierda: datos + ítems */}
      <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-6 space-y-6">
        <h2 className="text-lg font-semibold text-fm-on-surface">{titleLabel}</h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 space-y-1.5">
            <Label>Cliente *</Label>
            {mode === 'quote' && (
              <div className="inline-flex rounded-xl border border-fm-surface-container-high p-0.5 bg-fm-background mb-2">
                <button
                  type="button"
                  onClick={() => setClientMode('existing')}
                  disabled={saving}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                    clientMode === 'existing'
                      ? 'bg-fm-primary/10 text-fm-primary'
                      : 'text-fm-on-surface-variant hover:text-fm-on-surface'
                  }`}
                >
                  Cliente existente
                </button>
                <button
                  type="button"
                  onClick={() => setClientMode('prospect')}
                  disabled={saving}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                    clientMode === 'prospect'
                      ? 'bg-fm-primary/10 text-fm-primary'
                      : 'text-fm-on-surface-variant hover:text-fm-on-surface'
                  }`}
                >
                  Prospecto (sin crear cliente)
                </button>
              </div>
            )}
            {mode === 'invoice' || clientMode === 'existing' ? (
              <ClientSearchSelect
                clients={clients}
                value={clientId}
                onChange={setClientId}
                required={mode === 'invoice' || clientMode === 'existing'}
                disabled={saving}
              />
            ) : (
              <div className="space-y-2 rounded-xl border border-fm-surface-container-high p-3 bg-fm-background">
                <Label className="text-xs">Nombre del prospecto (opcional)</Label>
                <Input
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  disabled={saving}
                  placeholder="Déjalo vacío y aparecerá como “Sin cliente”"
                  className="rounded-xl"
                />
                <p className="text-xs text-fm-on-surface-variant">
                  La cotización se crea sin cliente vinculado. Si luego aceptan, crea el
                  cliente en el sistema antes de facturarla.
                </p>
              </div>
            )}
          </div>

          {mode === 'invoice' && cycle && !isContentPlan && (
            <div className="col-span-2 space-y-1.5">
              <Label>Ciclo de facturación</Label>
              <select
                value={cycleId}
                onChange={(e) => {
                  const v = e.target.value
                  setCycleId(v)
                  // Ad-hoc → sin quincena. Con ciclo + biweekly → quincena por defecto 'first'.
                  if (v === '') {
                    setBiweeklyHalf(null)
                  } else if (selectedClient?.billing_period === 'biweekly' && biweeklyHalf === null) {
                    setBiweeklyHalf('first')
                  }
                }}
                className="w-full py-2 px-3 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl text-fm-on-surface focus:outline-none focus:border-fm-primary"
              >
                <option value="">Factura ad-hoc (sin ciclo)</option>
                <option value={cycle.id}>
                  Ciclo actual: {cycle.period_start} — {cycle.period_end}
                </option>
                {nextPeriod && (
                  <option value="next">
                    Siguiente ciclo: {nextPeriod.periodStart} — {nextPeriod.periodEnd}
                  </option>
                )}
              </select>
              <p className="text-xs text-fm-outline">
                {isFirstInvoice
                  ? 'Primera factura del cliente — cubre el ciclo actual. Facturas posteriores cubrirán el ciclo siguiente.'
                  : 'Todos los clientes pagan por anticipado — por defecto la factura corresponde al siguiente ciclo.'}
              </p>
            </div>
          )}

          {mode === 'invoice' && cycleId && selectedClient?.billing_period === 'biweekly' && !isContentPlan && (
            <div className="col-span-2 space-y-1.5">
              <Label>Quincena a cobrar</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setBiweeklyHalf('first')}
                  className={
                    'flex-1 py-2 px-3 text-sm rounded-xl border transition-colors ' +
                    (biweeklyHalf === 'first'
                      ? 'bg-fm-primary/10 border-fm-primary text-fm-primary font-semibold'
                      : 'bg-fm-background border-fm-surface-container-high text-fm-on-surface hover:border-fm-primary/40')
                  }
                >
                  1ª quincena
                </button>
                <button
                  type="button"
                  onClick={() => setBiweeklyHalf('second')}
                  className={
                    'flex-1 py-2 px-3 text-sm rounded-xl border transition-colors ' +
                    (biweeklyHalf === 'second'
                      ? 'bg-fm-primary/10 border-fm-primary text-fm-primary font-semibold'
                      : 'bg-fm-background border-fm-surface-container-high text-fm-on-surface hover:border-fm-primary/40')
                  }
                >
                  2ª quincena
                </button>
              </div>
            </div>
          )}

          {selectedClient && (
            <div className="col-span-2 rounded-xl bg-fm-background border border-fm-surface-container-high p-3 text-xs text-fm-on-surface-variant">
              <p><strong className="text-fm-on-surface">Razón social:</strong> {selectedClient.legal_name ?? '—'}</p>
              <p><strong className="text-fm-on-surface">NIT:</strong> {selectedClient.nit ?? '—'} · <strong className="text-fm-on-surface">NRC:</strong> {selectedClient.nrc ?? '—'}</p>
              <p><strong className="text-fm-on-surface">Dirección:</strong> {selectedClient.fiscal_address ?? '—'}</p>
            </div>
          )}

          {mode === 'invoice' && selectedClient && (() => {
            const plan = plans.find(p => p.id === selectedClient.current_plan_id)
            const env: 'sandbox' | 'production' = (process.env.NEXT_PUBLIC_N1CO_ENV === 'production' ? 'production' : 'sandbox')
            const staticLink = env === 'production' ? plan?.n1co_payment_link_static_prod : plan?.n1co_payment_link_static_sandbox
            return (
              <div className="col-span-2 space-y-1.5">
                <Label>Método de cobro</Label>
                <select
                  value={paymentProvider}
                  onChange={(e) => setPaymentProvider(e.target.value as PaymentProvider)}
                  className="w-full py-2 px-3 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl text-fm-on-surface focus:outline-none focus:border-fm-primary"
                >
                  <option value="manual">Manual (efectivo / transferencia / cheque)</option>
                  <option value="n1co_link">Link n1co dinámico (recomendado)</option>
                  {staticLink && <option value="n1co_static">Link n1co estático ({plan?.name})</option>}
                </select>
                {paymentProvider === 'n1co_link' && (
                  <p className="text-xs text-fm-outline">
                    Se generará un payment link único con el monto exacto de esta factura. n1co cobra y emite el DTE.
                  </p>
                )}
                {paymentProvider === 'n1co_static' && staticLink && (
                  <p className="text-xs text-fm-outline">
                    Se enviará el link estático del plan: <span className="font-mono break-all">{staticLink}</span>
                  </p>
                )}
              </div>
            )
          })()}

          <div className="space-y-1.5">
            <Label>Impuesto (IVA)</Label>
            <div className="flex gap-2">
              <select value={String(taxRate)} onChange={(e) => setTaxRate(parseFloat(e.target.value))}
                className="flex-1 py-2 px-3 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl text-fm-on-surface focus:outline-none focus:border-fm-primary">
                <option value="0.13">IVA 13% (local)</option>
                <option value="0">Exento (0% — exterior)</option>
                <option value="-1">Personalizado</option>
              </select>
              {taxRate < 0 && (
                <Input type="number" step="0.01" min={0} max={1} defaultValue="0.13"
                  onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                  className="w-24 rounded-xl bg-fm-background border-fm-surface-container-high" />
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Descuento (USD)</Label>
            <Input type="number" min={0} step="0.01" value={discount}
              onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
              className="rounded-xl bg-fm-background border-fm-surface-container-high" />
          </div>

          <div className="col-span-2 flex items-center gap-3 rounded-xl bg-fm-background border border-fm-surface-container-high px-3 py-2.5">
            <input
              id="retention-toggle"
              type="checkbox"
              checked={retentionRate > 0}
              onChange={(e) => setRetentionRate(e.target.checked ? 0.1 : 0)}
              className="h-4 w-4 accent-fm-primary"
            />
            <label htmlFor="retention-toggle" className="text-sm text-fm-on-surface flex-1 cursor-pointer">
              Aplicar renta retenida (10%)
              <span className="block text-xs text-fm-outline">
                {selectedClient?.aplica_renta_retenida
                  ? 'Heredado del perfil del cliente. Puedes desmarcarlo para esta factura.'
                  : 'Marcar solo si esta factura específica aplica retención.'}
              </span>
            </label>
          </div>

          {mode === 'invoice' ? (
            <div className="space-y-1.5">
              <Label>Fecha de vencimiento</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                className="rounded-xl bg-fm-background border-fm-surface-container-high" />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Válida hasta</Label>
              <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)}
                className="rounded-xl bg-fm-background border-fm-surface-container-high" />
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <Label>Ítems</Label>
            {catalog.length > 0 && (
              <button
                type="button"
                onClick={() => setCatalogOpen(o => !o)}
                className="flex items-center gap-1 text-xs font-medium text-fm-primary hover:underline"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                  {catalogOpen ? 'expand_less' : 'add_circle'}
                </span>
                {catalogOpen ? 'Ocultar catálogo' : 'Agregar desde catálogo'}
              </button>
            )}
          </div>

          {catalogOpen && catalog.length > 0 && (
            <div className="mb-4 rounded-xl border border-fm-primary/20 bg-fm-primary/5 p-4 space-y-3">
              {catalog.map(group => (
                <div key={group.group}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-fm-outline mb-2">
                    {group.group}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {group.items.map((item, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => addFromCatalog(item)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-fm-primary/30 bg-white text-xs font-medium text-fm-on-surface hover:bg-fm-primary/10 hover:border-fm-primary transition-colors"
                      >
                        <span className="material-symbols-outlined text-fm-primary" style={{ fontSize: 13 }}>add</span>
                        <span>{item.label}</span>
                        <span className="text-fm-outline ml-1">${item.unit_price.toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <LineItemsEditor items={items} onChange={setItems} disabled={saving} />
        </div>

        <div className="space-y-1.5">
          <Label>Notas</Label>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Notas internas o para el cliente…"
            className="rounded-xl bg-fm-background border-fm-surface-container-high resize-none" />
        </div>

        {/* Términos y condiciones editables por documento */}
        <div className="rounded-xl border border-fm-outline-variant/30 bg-fm-background overflow-hidden">
          <button
            type="button"
            onClick={() => setTermsOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-fm-on-surface hover:bg-fm-surface-container-high/50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-fm-primary" style={{ fontSize: 16 }}>gavel</span>
              Términos y condiciones
              <span className="text-xs font-normal text-fm-on-surface-variant">
                ({terms.length} {terms.length === 1 ? 'cláusula' : 'cláusulas'})
              </span>
            </span>
            <span className="material-symbols-outlined text-fm-on-surface-variant" style={{ fontSize: 18 }}>
              {termsOpen ? 'expand_less' : 'expand_more'}
            </span>
          </button>

          {termsOpen && (
            <div className="px-4 pb-4 pt-1 space-y-2 border-t border-fm-outline-variant/20">
              <p className="text-xs text-fm-on-surface-variant pb-1">
                Se cargan los T&C globales como base. Puedes personalizar, agregar o eliminar cláusulas para este documento.
              </p>

              {terms.length === 0 && (
                <p className="text-xs text-fm-outline italic py-2">Sin cláusulas. Agrega una con el botón de abajo.</p>
              )}

              <div className="space-y-2">
                {terms.map((term, idx) => (
                  <div key={term.id} className="flex gap-2 items-start group">
                    {/* Número */}
                    <span className="mt-2 flex-shrink-0 w-5 text-center text-xs font-bold text-fm-on-surface-variant">{idx + 1}.</span>

                    {/* Contenido */}
                    {termsEditingId === term.id ? (
                      <div className="flex-1 space-y-1.5">
                        <Textarea
                          autoFocus
                          rows={3}
                          value={termsEditingText}
                          onChange={(e) => setTermsEditingText(e.target.value)}
                          className="rounded-xl bg-fm-surface-container-high border-fm-primary/40 resize-none text-sm w-full"
                          placeholder="Escribe la cláusula…"
                        />
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => saveTermEdit(term.id)}
                            className="text-white rounded-lg h-7 px-3 text-xs"
                            style={{ background: 'linear-gradient(135deg,#00675c,#5bf4de)' }}
                          >
                            Guardar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => cancelTermEdit(term.id)}
                            className="rounded-lg h-7 px-3 text-xs"
                          >
                            Cancelar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p
                        onClick={() => { setTermsEditingId(term.id); setTermsEditingText(term.text) }}
                        className="flex-1 text-sm text-fm-on-surface py-1.5 px-2 rounded-lg cursor-pointer hover:bg-fm-surface-container-high/60 transition-colors"
                      >
                        {term.text || <span className="italic text-fm-outline">Vacío — clic para editar</span>}
                      </p>
                    )}

                    {/* Acciones */}
                    {termsEditingId !== term.id && (
                      <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => moveTerm(term.id, 'up')}
                          disabled={idx === 0}
                          className="p-0.5 rounded text-fm-on-surface-variant hover:text-fm-primary disabled:opacity-30 transition-colors"
                          title="Subir"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_upward</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => moveTerm(term.id, 'down')}
                          disabled={idx === terms.length - 1}
                          className="p-0.5 rounded text-fm-on-surface-variant hover:text-fm-primary disabled:opacity-30 transition-colors"
                          title="Bajar"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_downward</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteTerm(term.id)}
                          className="p-0.5 rounded text-fm-on-surface-variant hover:text-fm-error transition-colors"
                          title="Eliminar"
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addTerm}
                className="mt-1 flex items-center gap-1.5 text-xs font-medium text-fm-primary hover:underline"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>add_circle</span>
                Agregar cláusula
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">
            {error}
          </p>
        )}
      </div>

      {/* Derecha: totales + acciones */}
      <div className="space-y-4">
        <div className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-fm-on-surface">Resumen</h3>
          <div className="flex items-center justify-between text-sm">
            <span className="text-fm-on-surface-variant">Subtotal</span>
            <span className="font-medium text-fm-on-surface">{formatCurrency(totals.subtotal)}</span>
          </div>
          {totals.discount_amount > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-fm-on-surface-variant">Descuento</span>
              <span className="font-medium text-fm-on-surface">−{formatCurrency(totals.discount_amount)}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-fm-on-surface-variant">IVA ({(taxRate * 100).toFixed(0)}%)</span>
            <span className="font-medium text-fm-on-surface">{formatCurrency(totals.tax_amount)}</span>
          </div>
          <div className="h-px bg-fm-surface-container-high" />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-fm-on-surface">
              {totals.retencion_renta_amount > 0 ? 'Total en DTE' : 'Total (USD)'}
            </span>
            <span className="text-xl font-bold text-fm-primary">{formatCurrency(totals.total)}</span>
          </div>

          {totals.retencion_renta_amount > 0 && (
            <>
              <div className="h-px bg-fm-surface-container-high mt-3" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-fm-outline">A cobrar</p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-fm-on-surface-variant">Subtotal</span>
                <span className="font-medium text-fm-on-surface">{formatCurrency(totals.subtotal)}</span>
              </div>
              {totals.discount_amount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-fm-on-surface-variant">Descuento</span>
                  <span className="font-medium text-fm-on-surface">−{formatCurrency(totals.discount_amount)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-fm-on-surface-variant">Renta retenida ({(totals.retention_rate * 100).toFixed(0)}%)</span>
                <span className="font-medium text-fm-on-surface">−{formatCurrency(totals.retencion_renta_amount)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-fm-on-surface-variant">IVA ({(taxRate * 100).toFixed(0)}%)</span>
                <span className="font-medium text-fm-on-surface">{formatCurrency(totals.tax_amount)}</span>
              </div>
              <div className="h-px bg-fm-surface-container-high" />
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-fm-on-surface">TOTAL A PAGAR</span>
                <span className="text-xl font-bold text-fm-primary">{formatCurrency(totals.total_a_pagar)}</span>
              </div>
            </>
          )}
        </div>

        <div className="space-y-2">
          <Button type="submit" disabled={saving} className="w-full rounded-xl text-white font-semibold"
            style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}>
            {saving ? 'Guardando…' : (mode === 'invoice' ? 'Crear factura' : 'Crear cotización')}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()} className="w-full rounded-xl">
            Cancelar
          </Button>
        </div>
      </div>
    </form>
  )
}
