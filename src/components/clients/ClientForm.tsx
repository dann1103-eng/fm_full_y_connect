'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'
import { currentCycleDates, firstCycleDates } from '@/lib/domain/cycles'
import { addDaysString, formatDateEs } from '@/lib/domain/dates'
import { ConfirmCycleRecalcDialog } from './ConfirmCycleRecalcDialog'
import type { BillingCycle, BillingPeriod, Client, PersonType } from '@/types/db'

interface Plan {
  id: string
  name: string
  price_usd: number
  unified_content_limit?: number | null
}

interface ClientFormProps {
  plans: Plan[]
  existing?: Client
}

export function ClientForm({ plans, existing }: ClientFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Default cycle start: the most recent occurrence of billing_day (not necessarily today)
  const initialBillingDay = parseInt(existing?.billing_day?.toString() ?? '1', 10)
  const defaultCycleStart = existing?.start_date
    ?? currentCycleDates(initialBillingDay).periodStart

  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>(existing?.billing_period ?? 'monthly')
  const [billingDay2, setBillingDay2] = useState(existing?.billing_day_2?.toString() ?? '')
  const [autoBilling, setAutoBilling] = useState(existing?.auto_billing ?? false)
  const [isForeign, setIsForeign] = useState(existing?.is_foreign ?? false)
  const [fiscalOpen, setFiscalOpen] = useState(false)
  const [recalcDialog, setRecalcDialog] = useState<
    | { open: true; periodStart: string; periodEnd: string; pending: () => Promise<void> }
    | { open: false }
  >({ open: false })
  const [form, setForm] = useState({
    name: existing?.name ?? '',
    contact_email: existing?.contact_email ?? '',
    contact_phone: existing?.contact_phone ?? '',
    ig_handle: existing?.ig_handle ?? '',
    fb_handle: existing?.fb_handle ?? '',
    tiktok_handle: existing?.tiktok_handle ?? '',
    yt_handle: existing?.yt_handle ?? '',
    linkedin_handle: existing?.linkedin_handle ?? '',
    website_url: existing?.website_url ?? '',
    other_contact: existing?.other_contact ?? '',
    notes: existing?.notes ?? '',
    current_plan_id: existing?.current_plan_id ?? (plans[0]?.id ?? ''),
    billing_day: existing?.billing_day?.toString() ?? '1',
    start_date: defaultCycleStart,
    legal_name: existing?.legal_name ?? '',
    person_type: (existing?.person_type ?? '') as PersonType | '',
    nit: existing?.nit ?? '',
    nrc: existing?.nrc ?? '',
    dui: existing?.dui ?? '',
    fiscal_address: existing?.fiscal_address ?? '',
    giro: existing?.giro ?? '',
  })

  const selectedPlan = plans.find(p => p.id === form.current_plan_id)
  const isContentPlan = (selectedPlan?.unified_content_limit ?? null) != null

  function set(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Validación: auto_billing requiere datos fiscales (salvo is_foreign).
    if (autoBilling && !isForeign) {
      if (!form.legal_name.trim() || !form.nit.trim()) {
        setError('Facturación automática requiere razón social y NIT (o marca "cliente extranjero").')
        return
      }
    }

    setLoading(true)

    const supabase = createClient()
    const billingDay = parseInt(form.billing_day, 10)

    const fiscalPayload = {
      legal_name: form.legal_name || null,
      person_type: form.person_type || null,
      nit: form.nit || null,
      nrc: form.nrc || null,
      dui: form.dui || null,
      fiscal_address: form.fiscal_address || null,
      giro: form.giro || null,
      auto_billing: autoBilling,
      is_foreign: isForeign,
    }

    if (existing) {
      const billingDayChanged =
        existing.billing_day !== billingDay ||
        (existing.billing_day_2 ?? null) !== (billingPeriod === 'biweekly' && billingDay2 ? parseInt(billingDay2, 10) : null) ||
        existing.start_date !== form.start_date ||
        existing.billing_period !== billingPeriod

      // Update client row (siempre se aplica)
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
          billing_day: billingDay,
          billing_day_2: billingPeriod === 'biweekly' && billingDay2 ? parseInt(billingDay2, 10) : null,
          billing_period: billingPeriod,
          start_date: form.start_date,
          ...fiscalPayload,
        })
        .eq('id', existing.id)

      if (updateError) {
        setError('Error al actualizar el cliente.')
        setLoading(false)
        return
      }

      // Recalcular ciclo: opt-in solo si las fechas/periodo cambiaron.
      if (!isContentPlan && billingDayChanged) {
        const { data: currentCycle } = await supabase
          .from('billing_cycles')
          .select('id, period_start, period_end')
          .eq('client_id', existing.id)
          .eq('status', 'current')
          .maybeSingle()

        if (currentCycle) {
          const cyc = currentCycle as Pick<BillingCycle, 'id' | 'period_start' | 'period_end'>
          // Mostrar dialog pidiendo confirmación
          const doRecalc = async () => {
            const { data: plan } = await supabase
              .from('plans')
              .select('*')
              .eq('id', form.current_plan_id)
              .single()
            if (plan) {
              const { periodStart, periodEnd } = firstCycleDates(form.start_date, {
                billingPeriod,
              })
              await supabase
                .from('billing_cycles')
                .update({
                  period_start: periodStart,
                  period_end: periodEnd,
                  plan_id_snapshot: plan.id,
                  limits_snapshot_json: plan.limits_json,
                })
                .eq('id', cyc.id)
            }
          }
          setLoading(false)
          setRecalcDialog({
            open: true,
            periodStart: cyc.period_start,
            periodEnd: cyc.period_end,
            pending: doRecalc,
          })
          return
        }
      }
    } else {
      // Insert client
      const { data: newClient, error: insertError } = await supabase
        .from('clients')
        .insert({
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
          billing_day: billingDay,
          billing_day_2: billingPeriod === 'biweekly' && billingDay2 ? parseInt(billingDay2, 10) : null,
          billing_period: billingPeriod,
          start_date: form.start_date,
          status: 'active',
          ...fiscalPayload,
        })
        .select()
        .single()

      if (insertError || !newClient) {
        setError('Error al crear el cliente.')
        setLoading(false)
        return
      }

      // Fetch plan limits snapshot
      const { data: plan } = await supabase
        .from('plans')
        .select('*')
        .eq('id', form.current_plan_id)
        .single()

      if (plan) {
        const { periodStart, periodEnd: datePeriodEnd } = firstCycleDates(form.start_date, {
          billingPeriod,
        })

        // Plan Contenido: expiración por consumo, no por fecha (+10 años para no vencer)
        const periodEnd = plan.unified_content_limit != null
          ? addDaysString(periodStart, 365 * 10)
          : datePeriodEnd

        // Copia el unified_content_limit del plan al snapshot (plan "Contenido")
        const snapshot = plan.unified_content_limit != null
          ? { ...plan.limits_json, unified_content_limit: plan.unified_content_limit }
          : plan.limits_json

        await supabase.from('billing_cycles').insert({
          client_id: newClient.id,
          plan_id_snapshot: plan.id,
          limits_snapshot_json: snapshot,
          rollover_from_previous_json: null,
          period_start: periodStart,
          period_end: periodEnd,
          status: 'current',
          payment_status: 'unpaid',
        })
      }
    }

    setLoading(false)
    setOpen(false)
    router.refresh()
  }

  async function handleRecalcDecision(recalc: boolean) {
    if (!recalcDialog.open) return
    const pending = recalcDialog.pending
    setRecalcDialog({ open: false })
    if (recalc) {
      setLoading(true)
      await pending()
      setLoading(false)
    }
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="text-white font-semibold rounded-xl"
        style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
      >
        + Nuevo cliente
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg rounded-2xl p-0 border border-fm-outline-variant/20 flex flex-col max-h-[90vh]">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-fm-outline-variant/10 flex-shrink-0">
          <DialogTitle className="text-lg font-semibold text-fm-on-surface">
            {existing ? 'Editar cliente' : 'Nuevo cliente'}
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1">
        <form onSubmit={handleSubmit} className="px-6 pb-6 pt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label>Nombre del cliente *</Label>
              <Input
                required
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Ej. Boutique Lara"
                className="rounded-xl bg-fm-background border-fm-surface-container-high"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Plan *</Label>
              <select
                required
                value={form.current_plan_id}
                onChange={(e) => set('current_plan_id', e.target.value)}
                className="w-full py-2 px-3 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl text-fm-on-surface focus:outline-none focus:border-fm-primary"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — ${p.price_usd}
                  </option>
                ))}
              </select>
            </div>

            {isContentPlan ? (
              <div className="col-span-2 rounded-2xl bg-fm-primary-container/10 border border-fm-primary/20 px-4 py-3 flex items-start gap-3">
                <span className="material-symbols-outlined text-fm-primary text-base flex-shrink-0 mt-0.5">inventory_2</span>
                <div>
                  <p className="text-xs font-bold text-fm-primary">Paquete de consumo</p>
                  <p className="text-xs text-fm-on-surface-variant mt-0.5">El paquete expira al registrar los 10 contenidos incluidos, sin límite de fecha.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Día de facturación *</Label>
                  <Input
                    required
                    type="number"
                    min={1}
                    max={31}
                    value={form.billing_day}
                    onChange={(e) => set('billing_day', e.target.value)}
                    className="rounded-xl bg-fm-background border-fm-surface-container-high"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Período de facturación</Label>
                  <select
                    value={billingPeriod}
                    onChange={(e) => setBillingPeriod(e.target.value as BillingPeriod)}
                    className="w-full py-2 px-3 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl text-fm-on-surface focus:outline-none focus:border-fm-primary"
                  >
                    <option value="monthly">Mensual</option>
                    <option value="biweekly">Quincenal</option>
                  </select>
                </div>

                {billingPeriod === 'biweekly' && (
                  <div className="space-y-1.5">
                    <Label>2° día de facturación *</Label>
                    <Input
                      required
                      type="number"
                      min={1}
                      max={31}
                      value={billingDay2}
                      onChange={(e) => setBillingDay2(e.target.value)}
                      placeholder="ej. 15"
                      className="rounded-xl bg-fm-background border-fm-surface-container-high"
                    />
                  </div>
                )}
              </>
            )}

            {!isContentPlan && (
              <div className="col-span-2 space-y-1.5">
                <Label>{existing ? 'Inicio del ciclo actual *' : 'Inicio del primer ciclo *'}</Label>
                <Input
                  required
                  type="date"
                  value={form.start_date}
                  onChange={(e) => set('start_date', e.target.value)}
                  className="rounded-xl bg-fm-background border-fm-surface-container-high"
                />
                {!isContentPlan && form.start_date && (() => {
                  const bd = parseInt(form.billing_day, 10)
                  if (!bd || bd < 1 || bd > 31) return null
                  const { periodEnd } = firstCycleDates(form.start_date, {
                    billingPeriod,
                  })
                  const fmt = (d: string) => formatDateEs(d)
                  return (
                    <p className="text-xs text-fm-on-surface-variant flex items-center gap-1 mt-1">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-fm-primary flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/>
                      </svg>
                      {existing ? 'Ciclo actual:' : 'Primer ciclo:'} <span className="font-medium text-fm-on-surface">{fmt(form.start_date)}</span>
                      <span className="text-fm-outline-variant">→</span>
                      <span className="font-medium text-fm-on-surface">{fmt(periodEnd)}</span>
                    </p>
                  )
                })()}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Correo de contacto</Label>
              <Input
                type="email"
                value={form.contact_email}
                onChange={(e) => set('contact_email', e.target.value)}
                placeholder="cliente@email.com"
                className="rounded-xl bg-fm-background border-fm-surface-container-high"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Teléfono</Label>
              <Input
                value={form.contact_phone}
                onChange={(e) => set('contact_phone', e.target.value)}
                placeholder="+503 7000 0000"
                className="rounded-xl bg-fm-background border-fm-surface-container-high"
              />
            </div>

            {/* ── Redes sociales ── */}
            <div className="col-span-2 pt-1">
              <p className="text-xs font-semibold text-fm-outline-variant uppercase tracking-widest mb-3">
                Redes sociales y contacto digital
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Instagram</Label>
                  <Input
                    value={form.ig_handle}
                    onChange={(e) => set('ig_handle', e.target.value)}
                    placeholder="@handle"
                    className="rounded-xl bg-fm-background border-fm-surface-container-high"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Facebook</Label>
                  <Input
                    value={form.fb_handle}
                    onChange={(e) => set('fb_handle', e.target.value)}
                    placeholder="nombre de página o URL"
                    className="rounded-xl bg-fm-background border-fm-surface-container-high"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>TikTok</Label>
                  <Input
                    value={form.tiktok_handle}
                    onChange={(e) => set('tiktok_handle', e.target.value)}
                    placeholder="@handle"
                    className="rounded-xl bg-fm-background border-fm-surface-container-high"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>YouTube</Label>
                  <Input
                    value={form.yt_handle}
                    onChange={(e) => set('yt_handle', e.target.value)}
                    placeholder="@canal o nombre"
                    className="rounded-xl bg-fm-background border-fm-surface-container-high"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>LinkedIn</Label>
                  <Input
                    value={form.linkedin_handle}
                    onChange={(e) => set('linkedin_handle', e.target.value)}
                    placeholder="nombre de empresa o URL"
                    className="rounded-xl bg-fm-background border-fm-surface-container-high"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Sitio web</Label>
                  <Input
                    value={form.website_url}
                    onChange={(e) => set('website_url', e.target.value)}
                    placeholder="https://ejemplo.com"
                    className="rounded-xl bg-fm-background border-fm-surface-container-high"
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Otro <span className="text-fm-outline-variant font-normal">(WhatsApp, Threads, etc.)</span></Label>
                  <Input
                    value={form.other_contact}
                    onChange={(e) => set('other_contact', e.target.value)}
                    placeholder="descripción y enlace o handle"
                    className="rounded-xl bg-fm-background border-fm-surface-container-high"
                  />
                </div>
              </div>
            </div>

            {/* ── Datos fiscales & facturación ── */}
            <div className="col-span-2 pt-1 border-t border-fm-outline-variant/10 mt-2">
              <button
                type="button"
                onClick={() => setFiscalOpen((v) => !v)}
                className="w-full flex items-center justify-between py-1 text-xs font-semibold text-fm-outline-variant uppercase tracking-widest"
              >
                <span>Datos fiscales</span>
                <span className="material-symbols-outlined text-[18px]">
                  {fiscalOpen ? 'expand_less' : 'expand_more'}
                </span>
              </button>

              {fiscalOpen && (
                <div className="grid grid-cols-2 gap-3 pt-3">
                  <div className="col-span-2 flex flex-col gap-2 rounded-xl bg-fm-background border border-fm-surface-container-high p-3">
                    <label className="flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={autoBilling}
                        onChange={(e) => setAutoBilling(e.target.checked)}
                        className="w-4 h-4 accent-fm-primary"
                      />
                      <span className="flex flex-col">
                        <span className="font-semibold text-fm-on-surface">Facturación automática</span>
                        <span className="text-xs text-fm-on-surface-variant">
                          Genera la factura 10 días antes del cierre del ciclo.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={isForeign}
                        onChange={(e) => setIsForeign(e.target.checked)}
                        className="w-4 h-4 accent-fm-primary"
                      />
                      <span className="flex flex-col">
                        <span className="font-semibold text-fm-on-surface">Cliente extranjero</span>
                        <span className="text-xs text-fm-on-surface-variant">
                          Cliente fuera de El Salvador — no requiere NIT/NRC.
                        </span>
                      </span>
                    </label>
                  </div>

                  <div className="col-span-2 space-y-1.5">
                    <Label>Razón social</Label>
                    <Input
                      value={form.legal_name}
                      onChange={(e) => set('legal_name', e.target.value)}
                      className="rounded-xl bg-fm-background border-fm-surface-container-high"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tipo de persona</Label>
                    <select
                      value={form.person_type}
                      onChange={(e) => set('person_type', e.target.value)}
                      className="w-full py-2 px-3 text-sm bg-fm-background border border-fm-surface-container-high rounded-xl text-fm-on-surface focus:outline-none focus:border-fm-primary"
                    >
                      <option value="">—</option>
                      <option value="natural">Natural</option>
                      <option value="juridical">Jurídica</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>NIT</Label>
                    <Input
                      value={form.nit}
                      onChange={(e) => set('nit', e.target.value)}
                      className="rounded-xl bg-fm-background border-fm-surface-container-high"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>NRC</Label>
                    <Input
                      value={form.nrc}
                      onChange={(e) => set('nrc', e.target.value)}
                      className="rounded-xl bg-fm-background border-fm-surface-container-high"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>DUI</Label>
                    <Input
                      value={form.dui}
                      onChange={(e) => set('dui', e.target.value)}
                      className="rounded-xl bg-fm-background border-fm-surface-container-high"
                    />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label>Dirección fiscal</Label>
                    <Input
                      value={form.fiscal_address}
                      onChange={(e) => set('fiscal_address', e.target.value)}
                      className="rounded-xl bg-fm-background border-fm-surface-container-high"
                    />
                  </div>
                  <div className="col-span-2 space-y-1.5">
                    <Label>Giro</Label>
                    <Input
                      value={form.giro}
                      onChange={(e) => set('giro', e.target.value)}
                      className="rounded-xl bg-fm-background border-fm-surface-container-high"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>Notas internas</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Detalles adicionales sobre el cliente..."
                className="rounded-xl bg-fm-background border-fm-surface-container-high resize-none"
                rows={3}
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              className="flex-1 rounded-xl"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-xl text-white font-semibold"
              style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
            >
              {loading ? 'Guardando...' : existing ? 'Guardar cambios' : 'Crear cliente'}
            </Button>
          </div>
        </form>
        </div>
      </DialogContent>
      </Dialog>

      {recalcDialog.open && (
        <ConfirmCycleRecalcDialog
          open
          periodStart={recalcDialog.periodStart}
          periodEnd={recalcDialog.periodEnd}
          onDecision={handleRecalcDecision}
          onCancel={() => {
            setRecalcDialog({ open: false })
            setOpen(false)
            router.refresh()
          }}
        />
      )}
    </>
  )
}
