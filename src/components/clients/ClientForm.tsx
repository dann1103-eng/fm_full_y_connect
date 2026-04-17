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
import { firstCycleDates } from '@/lib/domain/cycles'
import type { Client } from '@/types/db'

interface Plan {
  id: string
  name: string
  price_usd: number
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

  const [form, setForm] = useState({
    name: existing?.name ?? '',
    contact_email: existing?.contact_email ?? '',
    contact_phone: existing?.contact_phone ?? '',
    ig_handle: existing?.ig_handle ?? '',
    fb_handle: existing?.fb_handle ?? '',
    tiktok_handle: existing?.tiktok_handle ?? '',
    notes: existing?.notes ?? '',
    current_plan_id: existing?.current_plan_id ?? (plans[0]?.id ?? ''),
    billing_day: existing?.billing_day?.toString() ?? '1',
    start_date: existing?.start_date ?? new Date().toISOString().split('T')[0],
  })

  function set(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const billingDay = parseInt(form.billing_day, 10)

    if (existing) {
      // Update
      const { error: updateError } = await supabase
        .from('clients')
        .update({
          name: form.name,
          contact_email: form.contact_email || null,
          contact_phone: form.contact_phone || null,
          ig_handle: form.ig_handle || null,
          fb_handle: form.fb_handle || null,
          tiktok_handle: form.tiktok_handle || null,
          notes: form.notes || null,
          current_plan_id: form.current_plan_id,
          billing_day: billingDay,
        })
        .eq('id', existing.id)

      if (updateError) {
        setError('Error al actualizar el cliente.')
        setLoading(false)
        return
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
          notes: form.notes || null,
          current_plan_id: form.current_plan_id,
          billing_day: billingDay,
          start_date: form.start_date,
          status: 'active',
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
        const { periodStart, periodEnd } = firstCycleDates(form.start_date, billingDay)

        await supabase.from('billing_cycles').insert({
          client_id: newClient.id,
          plan_id_snapshot: plan.id,
          limits_snapshot_json: plan.limits_json,
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
      <DialogContent className="max-w-lg rounded-2xl p-0 overflow-hidden border border-[#abadaf]/20">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="text-lg font-semibold text-[#2c2f31]">
            {existing ? 'Editar cliente' : 'Nuevo cliente'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="px-6 pb-6 pt-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label>Nombre del cliente *</Label>
              <Input
                required
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Ej. Boutique Lara"
                className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Plan *</Label>
              <select
                required
                value={form.current_plan_id}
                onChange={(e) => set('current_plan_id', e.target.value)}
                className="w-full py-2 px-3 text-sm bg-[#f5f7f9] border border-[#dfe3e6] rounded-xl text-[#2c2f31] focus:outline-none focus:border-[#00675c]"
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — ${p.price_usd}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>Día de facturación *</Label>
              <Input
                required
                type="number"
                min={1}
                max={31}
                value={form.billing_day}
                onChange={(e) => set('billing_day', e.target.value)}
                className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]"
              />
            </div>

            {!existing && (
              <div className="space-y-1.5">
                <Label>Fecha de inicio *</Label>
                <Input
                  required
                  type="date"
                  value={form.start_date}
                  onChange={(e) => set('start_date', e.target.value)}
                  className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Correo de contacto</Label>
              <Input
                type="email"
                value={form.contact_email}
                onChange={(e) => set('contact_email', e.target.value)}
                placeholder="cliente@email.com"
                className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Teléfono</Label>
              <Input
                value={form.contact_phone}
                onChange={(e) => set('contact_phone', e.target.value)}
                placeholder="+503 7000 0000"
                className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Instagram</Label>
              <Input
                value={form.ig_handle}
                onChange={(e) => set('ig_handle', e.target.value)}
                placeholder="@handle"
                className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]"
              />
            </div>

            <div className="space-y-1.5">
              <Label>TikTok</Label>
              <Input
                value={form.tiktok_handle}
                onChange={(e) => set('tiktok_handle', e.target.value)}
                placeholder="@handle"
                className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6]"
              />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label>Notas internas</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Detalles adicionales sobre el cliente..."
                className="rounded-xl bg-[#f5f7f9] border-[#dfe3e6] resize-none"
                rows={3}
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-[#b31b25] bg-[#b31b25]/5 rounded-xl px-3 py-2 border border-[#b31b25]/20">
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
      </DialogContent>
      </Dialog>
    </>
  )
}
