export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { createWaAdminClient as createAdminClient } from '@/lib/whatsapp/db'
import { WaBotConfigTabs } from '@/components/whatsapp/WaBotConfigTabs'
import { WaBotUsageStats } from '@/components/whatsapp/WaBotUsageStats'
import type { WaBotConfig } from '@/types/db'

export default async function AdminWhatsappConfigPage() {
  const ctx = await getEffectiveUser()
  if (!ctx) redirect('/login')
  if (ctx.appUser.role !== 'admin') redirect('/')

  const admin = createAdminClient()
  const { data } = await admin.from('wa_bot_configs').select('*').order('audience')
  const configs = (data ?? []) as WaBotConfig[]

  const clientConfig = configs.find((c) => c.audience === 'client') ?? null
  const leadConfig = configs.find((c) => c.audience === 'lead') ?? null

  if (!clientConfig || !leadConfig) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-medium mb-3">Bot de WhatsApp — configuración</h1>
        <p className="text-sm text-fm-on-surface-variant">
          Falta aplicar la migración <code>0093_wa_bot_lead_config.sql</code> en Supabase.
          {!clientConfig && ' (Sin config para clientes.)'}
          {!leadConfig && ' (Sin config para leads.)'}
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-8 space-y-6">
      <header>
        <h1 className="text-xl font-medium text-fm-on-surface">Bot de WhatsApp — configuración</h1>
        <p className="text-sm text-fm-on-surface-variant mt-1">
          Hay dos prompts independientes: uno para clientes existentes (con marca vinculada) y otro para
          leads / prospectos. El bot detecta automáticamente cuál usar según el `client_id` de la conversación.
          Los cambios se aplican al próximo mensaje, sin redeploy.
        </p>
      </header>
      <WaBotUsageStats />
      <WaBotConfigTabs clientConfig={clientConfig} leadConfig={leadConfig} />
    </div>
  )
}
