export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getEffectiveUser } from '@/lib/auth/effective-user'
import { createWaAdminClient as createAdminClient } from '@/lib/whatsapp/db'
import { WaBotConfigForm } from '@/components/whatsapp/WaBotConfigForm'
import type { WaBotConfig } from '@/types/db'

export default async function AdminWhatsappConfigPage() {
  const ctx = await getEffectiveUser()
  if (!ctx) redirect('/login')
  if (ctx.appUser.role !== 'admin') redirect('/')

  const admin = createAdminClient()
  const { data } = await admin.from('wa_bot_configs').select('*').eq('id', 1).maybeSingle()
  const config = data as WaBotConfig | null

  if (!config) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-medium mb-3">Configuración del bot de WhatsApp</h1>
        <p className="text-sm text-fm-on-surface-variant">
          La fila singleton de <code>wa_bot_configs</code> no existe. Aplica la migración 0091
          en Supabase Dashboard.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-8 space-y-6">
      <header>
        <h1 className="text-xl font-medium text-fm-on-surface">Configuración del bot de WhatsApp</h1>
        <p className="text-sm text-fm-on-surface-variant mt-1">
          Edita el system prompt, las herramientas habilitadas y los parámetros del modelo.
          Los cambios se aplican al próximo mensaje que procese el worker (sin redeploy).
        </p>
      </header>
      <WaBotConfigForm config={config} />
    </div>
  )
}
