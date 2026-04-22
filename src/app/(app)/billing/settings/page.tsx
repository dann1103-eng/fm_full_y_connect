import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TopNav } from '@/components/layout/TopNav'
import { CompanySettingsForm } from '@/components/billing/CompanySettingsForm'
import { TermsAndConditionsEditor } from '@/components/billing/TermsAndConditionsEditor'
import { PaymentMethodsEditor } from '@/components/billing/PaymentMethodsEditor'
import type { CompanySettings, PaymentMethodConfig, TermAndCondition } from '@/types/db'

export const dynamic = 'force-dynamic'

export default async function BillingSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: appUser } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'admin') redirect('/billing')

  const admin = createAdminClient()
  const { data: settingsRow } = await admin.from('company_settings').select('*').limit(1).maybeSingle()
  const settings = settingsRow as CompanySettings | null

  const terms: TermAndCondition[] = (settings?.terms_and_conditions_json ?? []) as TermAndCondition[]
  const methods: PaymentMethodConfig[] = (settings?.payment_methods_json ?? []) as PaymentMethodConfig[]

  return (
    <div className="flex flex-col h-full">
      <TopNav title="Configuración de facturación" />

      <div className="flex-1 p-6 space-y-6 max-w-4xl">
        <Section title="Datos del emisor (FM)" description="Información fiscal que aparece en todas las facturas y cotizaciones.">
          <CompanySettingsForm initial={settings} />
        </Section>

        <Section title="Métodos de pago" description="Datos bancarios y tarjetas que se muestran al cliente en las cotizaciones.">
          <PaymentMethodsEditor initialMethods={methods} />
        </Section>

        <Section title="Términos y condiciones" description="Lista numerada que se incluye en la segunda página de cada cotización.">
          <TermsAndConditionsEditor initialTerms={terms} />
        </Section>
      </div>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="bg-fm-surface-container-lowest rounded-2xl border border-fm-outline-variant/20 p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-fm-on-surface">{title}</h2>
        <p className="text-sm text-fm-on-surface-variant mt-0.5">{description}</p>
      </div>
      {children}
    </section>
  )
}
