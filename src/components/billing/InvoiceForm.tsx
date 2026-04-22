'use client'

import { useMemo, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { calculateTotals, formatCurrency, suggestItemsFromPlan, STANDARD_CAMBIOS_PACKAGES, type LineItemInput } from '@/lib/domain/invoices'
import { EXTRA_CONTENT_PRICES, CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import { createInvoice } from '@/app/actions/invoices'
import { createQuote } from '@/app/actions/quotes'
import { LineItemsEditor } from './LineItemsEditor'
import type { Client, Plan, BillingCycle, CambiosPackage, ExtraContentItem } from '@/types/db'

interface CatalogItem {
  label: string
  description: string
  unit_price: number
  quantity: number
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

  const [clientId, setClientId] = useState(initialClientId ?? '')
  const [cycleId, setCycleId] = useState(initialCycleId ?? '')
  const [items, setItems] = useState<LineItemInput[]>([{ description: '', quantity: 1, unit_price: 0 }])
  const [taxRate, setTaxRate] = useState(0.13)
  const [discount, setDiscount] = useState(0)
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [validUntil, setValidUntil] = useState('')

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const [{ data: cs }, { data: ps }] = await Promise.all([
        supabase.from('clients').select('*').order('name'),
        supabase.from('plans').select('*').eq('active', true),
      ])
      setClients((cs ?? []) as Client[])
      setPlans((ps ?? []) as Plan[])
      setLoading(false)
    }
    load()
  }, [])

  // Precarga plan + IVA + ciclo al seleccionar cliente
  useEffect(() => {
    if (!clientId || loading) return
    const client = clients.find(c => c.id === clientId)
    if (!client) return
    setTaxRate(client.default_tax_rate ?? 0.13)

    const supabase = createClient()
    supabase
      .from('billing_cycles')
      .select('*')
      .eq('client_id', clientId)
      .eq('status', 'current')
      .maybeSingle()
      .then(({ data }) => {
        const cyc = data as BillingCycle | null
        setCycle(cyc)
        if (mode === 'invoice' && !initialCycleId && cyc) setCycleId(cyc.id)

        // Sugerir ítem del plan si el form aún tiene solo la línea vacía
        const plan = plans.find(p => p.id === client.current_plan_id)
        if (plan && items.length === 1 && !items[0].description && items[0].unit_price === 0) {
          const label = cyc
            ? `${plan.name} (${cyc.period_start} — ${cyc.period_end})`
            : undefined
          setItems(suggestItemsFromPlan(plan, label))
        }
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, loading])

  const totals = useMemo(
    () => calculateTotals({ items, tax_rate: taxRate, discount_amount: discount }),
    [items, taxRate, discount]
  )

  const selectedClient = useMemo(() => clients.find(c => c.id === clientId), [clients, clientId])

  // Catálogo de ítems predefinidos
  const catalog = useMemo<{ group: string; items: CatalogItem[] }[]>(() => {
    const groups: { group: string; items: CatalogItem[] }[] = []

    // Contenido extra estándar
    const contentItems: CatalogItem[] = (Object.entries(EXTRA_CONTENT_PRICES) as [keyof typeof EXTRA_CONTENT_PRICES, number][])
      .map(([type, price]) => ({
        label: CONTENT_TYPE_LABELS[type],
        description: `${CONTENT_TYPE_LABELS[type]} adicional`,
        unit_price: price,
        quantity: 1,
      }))
    if (contentItems.length) groups.push({ group: 'Contenido extra', items: contentItems })

    {
      // Paquetes de cambios: estándar + personalizados del ciclo
      const cambiosPkgs = (cycle?.cambios_packages_json ?? []) as CambiosPackage[]
      const cycleItems: CatalogItem[] = cambiosPkgs
        .filter(p => p.price_usd && p.price_usd > 0)
        .map((p) => ({
          label: `Cambios extra${p.note ? ` — ${p.note}` : ''} (${p.qty})`,
          description: `Paquete de cambios adicionales${p.note ? ` — ${p.note}` : ''} (${p.qty} cambios)`,
          unit_price: p.price_usd ?? 0,
          quantity: 1,
        }))

      const allCambios: CatalogItem[] = [
        ...STANDARD_CAMBIOS_PACKAGES,
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
  }, [cycle])

  const [catalogOpen, setCatalogOpen] = useState(false)

  function addFromCatalog(item: CatalogItem) {
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
    if (!clientId) { setError('Seleccione un cliente'); return }
    const validItems = items.filter(it => it.description.trim() && (it.quantity > 0) && (it.unit_price >= 0))
    if (validItems.length === 0) { setError('Agregue al menos una línea válida'); return }

    setSaving(true)
    const result = mode === 'invoice'
      ? await createInvoice({
          clientId,
          billingCycleId: cycleId || null,
          items: validItems,
          taxRate,
          discountAmount: discount,
          dueDate: dueDate || null,
          notes: notes || null,
        })
      : await createQuote({
          clientId,
          items: validItems,
          taxRate,
          discountAmount: discount,
          validUntil: validUntil || null,
          notes: notes || null,
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
            <select required value={clientId} onChange={(e) => setClientId(e.target.value)}
              className="w-full py-2 px-3 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl text-fm-on-surface focus:outline-none focus:border-fm-primary">
              <option value="">Seleccionar cliente…</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {mode === 'invoice' && cycle && (
            <div className="col-span-2 space-y-1.5">
              <Label>Ciclo de facturación (opcional)</Label>
              <select value={cycleId} onChange={(e) => setCycleId(e.target.value)}
                className="w-full py-2 px-3 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl text-fm-on-surface focus:outline-none focus:border-fm-primary">
                <option value="">Factura ad-hoc (sin ciclo)</option>
                <option value={cycle.id}>
                  Ciclo actual: {cycle.period_start} — {cycle.period_end}
                </option>
              </select>
              <p className="text-xs text-fm-outline">
                Al marcar pagada una factura ligada al ciclo, el ciclo también se marca pagado.
              </p>
            </div>
          )}

          {selectedClient && (
            <div className="col-span-2 rounded-xl bg-fm-background border border-fm-surface-container-high p-3 text-xs text-fm-on-surface-variant">
              <p><strong className="text-fm-on-surface">Razón social:</strong> {selectedClient.legal_name ?? '—'}</p>
              <p><strong className="text-fm-on-surface">NIT:</strong> {selectedClient.nit ?? '—'} · <strong className="text-fm-on-surface">NRC:</strong> {selectedClient.nrc ?? '—'}</p>
              <p><strong className="text-fm-on-surface">Dirección:</strong> {selectedClient.fiscal_address ?? '—'}</p>
            </div>
          )}

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
          <div className="flex items-center justify-between text-sm">
            <span className="text-fm-on-surface-variant">Descuento</span>
            <span className="font-medium text-fm-on-surface">−{formatCurrency(totals.discount_amount)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-fm-on-surface-variant">IVA ({(taxRate * 100).toFixed(0)}%)</span>
            <span className="font-medium text-fm-on-surface">{formatCurrency(totals.tax_amount)}</span>
          </div>
          <div className="h-px bg-fm-surface-container-high" />
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-fm-on-surface">Total (USD)</span>
            <span className="text-xl font-bold text-fm-primary">{formatCurrency(totals.total)}</span>
          </div>
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
