'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { updateCompanySettings, type CompanySettingsInput } from '@/app/actions/company-settings'
import type { CompanySettings } from '@/types/db'

interface CompanySettingsFormProps {
  initial: CompanySettings | null
}

export function CompanySettingsForm({ initial }: CompanySettingsFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState<CompanySettingsInput>({
    legal_name: initial?.legal_name ?? '',
    trade_name: initial?.trade_name ?? null,
    nit: initial?.nit ?? null,
    nrc: initial?.nrc ?? null,
    fiscal_address: initial?.fiscal_address ?? null,
    giro: initial?.giro ?? null,
    phone: initial?.phone ?? null,
    email: initial?.email ?? null,
    logo_url: initial?.logo_url ?? null,
    invoice_footer_note: initial?.invoice_footer_note ?? null,
  })
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  function set<K extends keyof CompanySettingsInput>(key: K, value: CompanySettingsInput[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setOk(false)
    if (!form.legal_name.trim()) { setError('La razón social es obligatoria'); return }
    startTransition(async () => {
      const result = await updateCompanySettings(form)
      if ('error' in result) { setError(result.error); return }
      setOk(true)
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2 space-y-1.5">
          <Label>Razón social *</Label>
          <Input required value={form.legal_name} onChange={(e) => set('legal_name', e.target.value)}
            className="rounded-xl bg-fm-background border-fm-surface-container-high" />
        </div>
        <div className="space-y-1.5">
          <Label>Nombre comercial</Label>
          <Input value={form.trade_name ?? ''} onChange={(e) => set('trade_name', e.target.value || null)}
            className="rounded-xl bg-fm-background border-fm-surface-container-high" />
        </div>
        <div className="space-y-1.5">
          <Label>Giro</Label>
          <Input value={form.giro ?? ''} onChange={(e) => set('giro', e.target.value || null)}
            className="rounded-xl bg-fm-background border-fm-surface-container-high" />
        </div>
        <div className="space-y-1.5">
          <Label>NIT</Label>
          <Input value={form.nit ?? ''} onChange={(e) => set('nit', e.target.value || null)}
            className="rounded-xl bg-fm-background border-fm-surface-container-high" />
        </div>
        <div className="space-y-1.5">
          <Label>NRC</Label>
          <Input value={form.nrc ?? ''} onChange={(e) => set('nrc', e.target.value || null)}
            className="rounded-xl bg-fm-background border-fm-surface-container-high" />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label>Dirección fiscal</Label>
          <Textarea rows={2} value={form.fiscal_address ?? ''} onChange={(e) => set('fiscal_address', e.target.value || null)}
            className="rounded-xl bg-fm-background border-fm-surface-container-high resize-none" />
        </div>
        <div className="space-y-1.5">
          <Label>Teléfono</Label>
          <Input value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value || null)}
            className="rounded-xl bg-fm-background border-fm-surface-container-high" />
        </div>
        <div className="space-y-1.5">
          <Label>Email</Label>
          <Input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value || null)}
            className="rounded-xl bg-fm-background border-fm-surface-container-high" />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label>URL del logo</Label>
          <Input value={form.logo_url ?? ''} onChange={(e) => set('logo_url', e.target.value || null)}
            placeholder="https://…"
            className="rounded-xl bg-fm-background border-fm-surface-container-high" />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label>Nota al pie de factura</Label>
          <Textarea rows={2} value={form.invoice_footer_note ?? ''} onChange={(e) => set('invoice_footer_note', e.target.value || null)}
            placeholder="Gracias por su preferencia…"
            className="rounded-xl bg-fm-background border-fm-surface-container-high resize-none" />
        </div>
      </div>

      {error && (
        <p className="text-sm text-fm-error bg-fm-error/5 rounded-xl px-3 py-2 border border-fm-error/20">
          {error}
        </p>
      )}
      {ok && (
        <p className="text-sm text-fm-primary bg-fm-primary/5 rounded-xl px-3 py-2 border border-fm-primary/20">
          Configuración guardada correctamente.
        </p>
      )}

      <Button
        type="submit"
        disabled={isPending}
        className="rounded-xl text-white font-semibold"
        style={{ background: 'linear-gradient(135deg, #00675c 0%, #5bf4de 100%)' }}
      >
        {isPending ? 'Guardando…' : 'Guardar configuración'}
      </Button>
    </form>
  )
}
