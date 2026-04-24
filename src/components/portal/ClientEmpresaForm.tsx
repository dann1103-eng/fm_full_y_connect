'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateClientProfile } from '@/app/actions/clientProfile'
import { LogoUploader } from '@/components/clients/LogoUploader'
import { CONTENT_TYPE_LABELS, limitsToRecord } from '@/lib/domain/plans'
import type {
  BillingCycle,
  CambiosPackage,
  ClientWithPlan,
  ContentType,
  ExtraContentItem,
  PersonType,
} from '@/types/db'

type CycleSlim = Pick<
  BillingCycle,
  'id' | 'period_start' | 'period_end' | 'cambios_packages_json' | 'extra_content_json' | 'status'
>

interface Props {
  client: ClientWithPlan
  cycle: CycleSlim | null
}

type FormState = {
  name: string
  logo_url: string | null
  contact_email: string
  contact_phone: string
  website_url: string
  other_contact: string
  ig_handle: string
  fb_handle: string
  tiktok_handle: string
  yt_handle: string
  linkedin_handle: string
  legal_name: string
  person_type: PersonType | ''
  nit: string
  nrc: string
  dui: string
  giro: string
  fiscal_address: string
  country_code: string
}

function initialFromClient(c: ClientWithPlan): FormState {
  return {
    name: c.name ?? '',
    logo_url: c.logo_url ?? null,
    contact_email: c.contact_email ?? '',
    contact_phone: c.contact_phone ?? '',
    website_url: c.website_url ?? '',
    other_contact: c.other_contact ?? '',
    ig_handle: c.ig_handle ?? '',
    fb_handle: c.fb_handle ?? '',
    tiktok_handle: c.tiktok_handle ?? '',
    yt_handle: c.yt_handle ?? '',
    linkedin_handle: c.linkedin_handle ?? '',
    legal_name: c.legal_name ?? '',
    person_type: (c.person_type as PersonType | null) ?? '',
    nit: c.nit ?? '',
    nrc: c.nrc ?? '',
    dui: c.dui ?? '',
    giro: c.giro ?? '',
    fiscal_address: c.fiscal_address ?? '',
    country_code: c.country_code ?? '',
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function ClientEmpresaForm({ client, cycle }: Props) {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(initialFromClient(client))
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!form.name.trim()) {
      setMsg({ ok: false, text: 'El nombre de la empresa es requerido.' })
      return
    }
    startTransition(async () => {
      try {
        const payload: Record<string, string | null> = {
          name: form.name.trim(),
          logo_url: form.logo_url,
          contact_email: form.contact_email.trim() || null,
          contact_phone: form.contact_phone.trim() || null,
          website_url: form.website_url.trim() || null,
          other_contact: form.other_contact.trim() || null,
          ig_handle: form.ig_handle.trim() || null,
          fb_handle: form.fb_handle.trim() || null,
          tiktok_handle: form.tiktok_handle.trim() || null,
          yt_handle: form.yt_handle.trim() || null,
          linkedin_handle: form.linkedin_handle.trim() || null,
          legal_name: form.legal_name.trim() || null,
          person_type: form.person_type || null,
          nit: form.nit.trim() || null,
          nrc: form.nrc.trim() || null,
          dui: form.dui.trim() || null,
          giro: form.giro.trim() || null,
          fiscal_address: form.fiscal_address.trim() || null,
          country_code: form.country_code.trim() || null,
        }
        await updateClientProfile(client.id, payload)
        setMsg({ ok: true, text: 'Datos actualizados correctamente.' })
        router.refresh()
      } catch (err) {
        setMsg({ ok: false, text: err instanceof Error ? err.message : 'Error al guardar' })
      }
    })
  }

  const plan = client.plan
  const planLimits = plan ? limitsToRecord(plan.limits_json) : null
  const cambiosPackages = (cycle?.cambios_packages_json ?? []) as CambiosPackage[]
  const extraContent = (cycle?.extra_content_json ?? []) as ExtraContentItem[]

  const billingPeriodLabel =
    client.billing_period === 'biweekly' ? 'Quincenal (dos pagos al mes)' : 'Mensual'

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fm-on-surface mb-1">Mi empresa</h1>
        <p className="text-sm text-fm-on-surface-variant">
          Edita los datos de tu empresa y revisa tu plan contratado.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Datos generales */}
        <section className="glass-panel p-5 space-y-4">
          <h2 className="text-base font-semibold text-fm-on-surface">Datos generales</h2>

          <LogoUploader
            value={form.logo_url}
            onChange={(url) => set('logo_url', url)}
            clientId={client.id}
            clientName={form.name || 'Mi empresa'}
          />

          <Field label="Nombre de la empresa">
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface"
            />
          </Field>

          <Field label="Email de contacto">
            <input
              type="email"
              value={form.contact_email}
              onChange={(e) => set('contact_email', e.target.value)}
              className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface"
            />
          </Field>

          <Field label="Teléfono">
            <input
              type="tel"
              value={form.contact_phone}
              onChange={(e) => set('contact_phone', e.target.value)}
              className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface"
            />
          </Field>

          <Field label="Sitio web">
            <input
              type="url"
              value={form.website_url}
              onChange={(e) => set('website_url', e.target.value)}
              className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface"
            />
          </Field>

          <Field label="Otro contacto">
            <input
              type="text"
              value={form.other_contact}
              onChange={(e) => set('other_contact', e.target.value)}
              className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface"
            />
          </Field>
        </section>

        {/* Información de facturación (read-only) */}
        <section className="glass-panel p-5 space-y-3">
          <div>
            <h2 className="text-base font-semibold text-fm-on-surface">Información de facturación</h2>
            <p className="text-xs text-fm-on-surface-variant mt-0.5">
              Si necesitas cambiar tu ciclo de facturación, contacta a tu agencia.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ReadOnlyField label="Periodo" value={billingPeriodLabel} />
            <ReadOnlyField label="Día de facturación" value={String(client.billing_day)} />
            {client.billing_period === 'biweekly' && (
              <ReadOnlyField
                label="Segundo día"
                value={client.billing_day_2 != null ? String(client.billing_day_2) : '—'}
              />
            )}
          </div>
        </section>

        {/* Redes sociales */}
        <section className="glass-panel p-5 space-y-4">
          <h2 className="text-base font-semibold text-fm-on-surface">Redes sociales</h2>
          <Field label="Instagram (@usuario)">
            <input type="text" value={form.ig_handle} onChange={(e) => set('ig_handle', e.target.value)} className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface" />
          </Field>
          <Field label="Facebook (@página)">
            <input type="text" value={form.fb_handle} onChange={(e) => set('fb_handle', e.target.value)} className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface" />
          </Field>
          <Field label="TikTok (@usuario)">
            <input type="text" value={form.tiktok_handle} onChange={(e) => set('tiktok_handle', e.target.value)} className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface" />
          </Field>
          <Field label="YouTube (canal)">
            <input type="text" value={form.yt_handle} onChange={(e) => set('yt_handle', e.target.value)} className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface" />
          </Field>
          <Field label="LinkedIn (empresa)">
            <input type="text" value={form.linkedin_handle} onChange={(e) => set('linkedin_handle', e.target.value)} className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface" />
          </Field>
        </section>

        {/* Datos fiscales */}
        <section className="glass-panel p-5 space-y-4">
          <h2 className="text-base font-semibold text-fm-on-surface">Datos fiscales</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Razón social">
              <input type="text" value={form.legal_name} onChange={(e) => set('legal_name', e.target.value)} className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface" />
            </Field>

            <Field label="Tipo de persona">
              <select
                value={form.person_type}
                onChange={(e) => set('person_type', e.target.value as PersonType | '')}
                className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface"
              >
                <option value="">—</option>
                <option value="natural">Natural</option>
                <option value="juridical">Jurídica</option>
              </select>
            </Field>

            <Field label="NIT">
              <input type="text" value={form.nit} onChange={(e) => set('nit', e.target.value)} className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface" />
            </Field>

            <Field label="NRC">
              <input type="text" value={form.nrc} onChange={(e) => set('nrc', e.target.value)} className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface" />
            </Field>

            <Field label="DUI">
              <input type="text" value={form.dui} onChange={(e) => set('dui', e.target.value)} className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface" />
            </Field>

            <Field label="País (ISO)">
              <input type="text" maxLength={2} value={form.country_code} onChange={(e) => set('country_code', e.target.value.toUpperCase())} className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface" placeholder="SV" />
            </Field>
          </div>

          <Field label="Giro">
            <input type="text" value={form.giro} onChange={(e) => set('giro', e.target.value)} className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface" />
          </Field>

          <Field label="Dirección fiscal">
            <textarea
              rows={2}
              value={form.fiscal_address}
              onChange={(e) => set('fiscal_address', e.target.value)}
              className="w-full rounded-lg border border-fm-outline-variant/40 bg-fm-surface-container-lowest px-3 py-2 text-sm text-fm-on-surface"
            />
          </Field>
        </section>

        {msg && (
          <p className={`text-sm ${msg.ok ? 'text-fm-primary' : 'text-fm-error'}`}>{msg.text}</p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-fm-primary text-white px-6 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isPending ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>

      {/* Mi plan (read-only) */}
      {plan && (
        <section className="glass-panel p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-fm-on-surface">Mi plan</h2>
            <p className="text-xs text-fm-on-surface-variant mt-0.5">Información de tu plan contratado.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <ReadOnlyField label="Nombre del plan" value={plan.name} />
            <ReadOnlyField label="Precio mensual" value={`$${plan.price_usd.toFixed(2)}`} />
            <ReadOnlyField label="Cambios incluidos" value={String(plan.cambios_included ?? 0)} />
          </div>

          {planLimits && (
            <div>
              <p className="text-xs font-medium text-fm-on-surface-variant mb-2 uppercase tracking-wide">
                Contenidos incluidos por ciclo
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(Object.entries(planLimits) as [ContentType, number][])
                  .filter(([, qty]) => qty > 0)
                  .map(([type, qty]) => (
                    <div
                      key={type}
                      className="rounded-lg border border-fm-outline-variant/30 px-3 py-2 flex items-center justify-between bg-fm-surface-container-lowest/50"
                    >
                      <span className="text-xs text-fm-on-surface-variant">
                        {CONTENT_TYPE_LABELS[type] ?? type}
                      </span>
                      <span className="text-sm font-semibold text-fm-on-surface">{qty}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {plan.unified_content_limit != null && (
            <p className="text-xs text-fm-on-surface-variant">
              Pool unificado: {plan.unified_content_limit} contenidos por ciclo.
            </p>
          )}
        </section>
      )}

      {/* Paquetes extra (read-only) */}
      <section className="glass-panel p-5 space-y-4">
        <div>
          <h2 className="text-base font-semibold text-fm-on-surface">Paquetes extra</h2>
          <p className="text-xs text-fm-on-surface-variant mt-0.5">
            Agregados comprados durante el ciclo actual.
            {cycle && ` (${formatDate(cycle.period_start)} – ${formatDate(cycle.period_end)})`}
          </p>
        </div>

        {cambiosPackages.length === 0 && extraContent.length === 0 ? (
          <p className="text-sm text-fm-on-surface-variant italic">
            No hay paquetes extra comprados este ciclo.
          </p>
        ) : (
          <div className="space-y-4">
            {cambiosPackages.length > 0 && (
              <div>
                <p className="text-xs font-medium text-fm-on-surface-variant mb-2 uppercase tracking-wide">
                  Paquetes de cambios
                </p>
                <div className="space-y-1.5">
                  {cambiosPackages.map((pkg, idx) => (
                    <div
                      key={`${pkg.created_at}-${idx}`}
                      className="flex items-center justify-between rounded-lg border border-fm-outline-variant/30 px-3 py-2 text-sm"
                    >
                      <div>
                        <p className="font-medium text-fm-on-surface">+{pkg.qty} cambios</p>
                        {pkg.note && <p className="text-xs text-fm-on-surface-variant">{pkg.note}</p>}
                      </div>
                      <div className="text-right text-xs text-fm-on-surface-variant">
                        <p>{pkg.price_usd != null ? `$${pkg.price_usd.toFixed(2)}` : '—'}</p>
                        <p>{formatDate(pkg.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {extraContent.length > 0 && (
              <div>
                <p className="text-xs font-medium text-fm-on-surface-variant mb-2 uppercase tracking-wide">
                  Contenidos extra
                </p>
                <div className="space-y-1.5">
                  {extraContent.map((item, idx) => (
                    <div
                      key={`${item.created_at}-${idx}`}
                      className="flex items-center justify-between rounded-lg border border-fm-outline-variant/30 px-3 py-2 text-sm"
                    >
                      <div>
                        <p className="font-medium text-fm-on-surface">
                          {item.qty} × {item.label}
                        </p>
                        {item.note && <p className="text-xs text-fm-on-surface-variant">{item.note}</p>}
                      </div>
                      <div className="text-right text-xs text-fm-on-surface-variant">
                        <p>${(item.price_per_unit * item.qty).toFixed(2)}</p>
                        <p>{formatDate(item.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

/** Wrapper para inputs con label arriba. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-fm-on-surface">{label}</label>
      {children}
    </div>
  )
}

/** Field de solo lectura para información que el cliente no puede editar. */
function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-fm-on-surface-variant uppercase tracking-wide">
        {label}
      </p>
      <p className="text-sm text-fm-on-surface">{value}</p>
    </div>
  )
}
