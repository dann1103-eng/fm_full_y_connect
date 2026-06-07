'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { createWaAdminClient } from '@/lib/whatsapp/db'

/**
 * Encola una notificación por WhatsApp al cliente cuando un requerimiento
 * acaba de entrar a fase `revision_cliente`. Usa la plantilla aprobada
 * `revision_cliente_lista` (declarada en src/lib/whatsapp/templates.ts).
 *
 * No-op silencioso si:
 *  - el cliente no tiene wa_bot_enabled
 *  - no hay contacto WhatsApp asociado al cliente
 *  - el requerimiento ya no está en revision_cliente (race con re-mover)
 *
 * Llamar desde cualquier código que cambia phase a revision_cliente. La función
 * es defensiva: nunca lanza, solo loguea.
 */
export async function enqueueReviewReadyNotification(requirementId: string): Promise<void> {
  if (!requirementId) return

  try {
    const admin = createAdminClient()
    const wa = createWaAdminClient()

    // 1. Confirmar que el req sigue en revision_cliente y obtener cliente.
    const reqRes = await admin
      .from('requirements')
      .select('id, title, content_type, phase, billing_cycles!inner ( client_id )')
      .eq('id', requirementId)
      .maybeSingle()
    if (reqRes.error || !reqRes.data) return
    const row = reqRes.data as unknown as {
      id: string; title: string | null; content_type: string; phase: string
      billing_cycles: { client_id: string } | null
    }
    if (row.phase !== 'revision_cliente') return
    const clientId = row.billing_cycles?.client_id
    if (!clientId) return

    // 2. Cliente con bot habilitado.
    const cl = await admin
      .from('clients')
      .select('id, name, wa_bot_enabled')
      .eq('id', clientId)
      .maybeSingle()
    if (!cl.data) return
    const client = cl.data as { id: string; name: string; wa_bot_enabled: boolean }
    if (client.wa_bot_enabled === false) return

    // 3. Contacto WhatsApp primario (o el primero registrado).
    const contactRes = await wa
      .from('client_whatsapp_contacts')
      .select('phone_e164, display_name, is_primary')
      .eq('client_id', clientId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    const contact = contactRes.data as
      | { phone_e164: string; display_name: string | null; is_primary: boolean }
      | null
    if (!contact?.phone_e164) return

    // 4. Encolar job de plantilla.
    const portalUrl =
      (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.fullefm.site') +
      '/portal/pipeline'

    const title = row.title?.trim() || row.content_type

    await admin.from('ai_jobs').insert({
      job_type: 'whatsapp_template',
      status: 'pending',
      priority: 4,
      requirement_id: requirementId,
      client_id: clientId,
      input_json: {
        phoneE164: contact.phone_e164,
        templateKey: 'REVIEW_READY',
        clientId,
        params: {
          client_name: contact.display_name || client.name,
          requirement_title: title,
          portal_url: portalUrl,
        },
      },
      scheduled_for: new Date().toISOString(),
    } as never)

    // 5. Disparar runner de inmediato (fire-and-forget).
    const secret = process.env.AI_JOBS_TRIGGER_SECRET
    if (secret) {
      const base =
        process.env.NEXT_PUBLIC_SITE_URL ??
        process.env.NEXT_PUBLIC_APP_URL ??
        'https://www.fullefm.site'
      void fetch(`${base}/api/ai-jobs/process?max=2&wait=0`, {
        method: 'POST',
        headers: { 'x-trigger-secret': secret, 'content-type': 'application/json' },
        body: '{}',
        cache: 'no-store',
        keepalive: true,
      }).catch(() => {})
    }
  } catch (e) {
    console.warn('[enqueueReviewReadyNotification] non-fatal error', e)
  }
}
