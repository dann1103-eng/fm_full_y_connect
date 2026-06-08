'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createWaAdminClient } from '@/lib/whatsapp/db'

export type WaLeadStatus = 'active' | 'escalated' | 'converted' | 'rejected' | 'archived'

type Result<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string }

async function requireAgencyUser() {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { ok: false as const, error: 'No autenticado' }
  const { data: user } = await supabase
    .from('users')
    .select('id,role')
    .eq('id', auth.user.id)
    .single()
  if (!user || user.role === 'client') return { ok: false as const, error: 'No autorizado' }
  return { ok: true as const, userId: user.id, role: user.role }
}

// ────────────────────────────────────────────────────────────
// Cambiar estado del lead (escalado, descartado, archivado)
// ────────────────────────────────────────────────────────────
export async function updateLeadStatus(args: {
  leadId: string
  status: WaLeadStatus
  rejectedReason?: string
}): Promise<Result> {
  const guard = await requireAgencyUser()
  if (!guard.ok) return guard

  const wa = createWaAdminClient()
  const update: Record<string, unknown> = {
    status: args.status,
    status_updated_by: guard.userId,
  }
  if (args.status === 'rejected' && args.rejectedReason) {
    update.rejected_reason = args.rejectedReason.slice(0, 500)
  }

  const { error } = await wa.from('wa_leads').update(update).eq('id', args.leadId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/whatsapp/leads')
  return { ok: true }
}

// ────────────────────────────────────────────────────────────
// Asignar lead a un comercial
// ────────────────────────────────────────────────────────────
export async function assignLead(args: { leadId: string; userId: string | null }): Promise<Result> {
  const guard = await requireAgencyUser()
  if (!guard.ok) return guard

  const wa = createWaAdminClient()
  const { error } = await wa
    .from('wa_leads')
    .update({ assigned_to_user_id: args.userId })
    .eq('id', args.leadId)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/whatsapp/leads')
  return { ok: true }
}

// ────────────────────────────────────────────────────────────
// Convertir lead a cliente (crea cliente nuevo, vincula conv y lead)
// ────────────────────────────────────────────────────────────
export async function convertLeadToClient(args: {
  leadId: string
  clientName: string
  planId: string
  billingDay: number
  startDate: string
}): Promise<Result<{ clientId: string }>> {
  const guard = await requireAgencyUser()
  if (!guard.ok) return guard

  if (!args.clientName?.trim()) return { ok: false, error: 'El nombre del cliente es obligatorio.' }
  if (!args.planId) return { ok: false, error: 'Selecciona un plan.' }

  const admin = createAdminClient()
  const wa = createWaAdminClient()

  // 1. Obtener el lead + su conversación.
  const lead = await wa
    .from('wa_leads')
    .select('id, conversation_id, phone_e164, contact_name, notes, company_name')
    .eq('id', args.leadId)
    .maybeSingle()
  if (lead.error || !lead.data) return { ok: false, error: 'Lead no encontrado.' }
  const leadRow = lead.data as {
    id: string; conversation_id: string; phone_e164: string
    contact_name: string | null; notes: string | null; company_name: string | null
  }

  // 2. Crear cliente con datos mínimos.
  const clientIns = await admin
    .from('clients')
    .insert({
      name: args.clientName.trim(),
      current_plan_id: args.planId,
      billing_day: args.billingDay,
      start_date: args.startDate,
      status: 'active',
      contact_phone: leadRow.phone_e164,
      notes: leadRow.notes
        ? `[Convertido desde lead]\n${leadRow.notes}`
        : '[Convertido desde lead de WhatsApp]',
    })
    .select('id')
    .single()
  if (clientIns.error || !clientIns.data) {
    return { ok: false, error: clientIns.error?.message ?? 'No se pudo crear el cliente.' }
  }
  const clientId = (clientIns.data as { id: string }).id

  // 3. Vincular conversación y registrar contacto WhatsApp.
  await wa
    .from('wa_conversations')
    .update({ client_id: clientId })
    .eq('id', leadRow.conversation_id)

  await wa.from('client_whatsapp_contacts').insert({
    client_id: clientId,
    phone_e164: leadRow.phone_e164,
    display_name: leadRow.contact_name,
    is_primary: true,
  })

  // 4. Marcar lead como convertido.
  await wa
    .from('wa_leads')
    .update({
      status: 'converted',
      converted_to_client_id: clientId,
      converted_at: new Date().toISOString(),
      status_updated_by: guard.userId,
    })
    .eq('id', args.leadId)

  revalidatePath('/whatsapp/leads')
  revalidatePath(`/clients/${clientId}`)
  return { ok: true, clientId }
}

// ────────────────────────────────────────────────────────────
// Editar manualmente campos del lead (el staff puede corregir lo que recolectó el bot)
// ────────────────────────────────────────────────────────────
export async function updateLeadFields(args: {
  leadId: string
  fields: Partial<{
    company_name: string | null
    contact_name: string | null
    interest: string | null
    budget_range: string | null
    urgency: string | null
    notes: string | null
  }>
}): Promise<Result> {
  const guard = await requireAgencyUser()
  if (!guard.ok) return guard
  const wa = createWaAdminClient()
  const { error } = await wa.from('wa_leads').update(args.fields).eq('id', args.leadId)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/whatsapp/leads')
  return { ok: true }
}
