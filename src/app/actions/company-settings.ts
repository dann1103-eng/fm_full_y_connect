'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PaymentMethodConfig, TermAndCondition } from '@/types/db'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' as const }
  const { data: appUser } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'admin') return { error: 'Solo admins pueden modificar la configuración del emisor' as const }
  return { userId: user.id }
}

async function getSettingsId(): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin.from('company_settings').select('id').limit(1).maybeSingle()
  return data?.id ?? null
}

export interface CompanySettingsInput {
  legal_name: string
  trade_name: string | null
  nit: string | null
  nrc: string | null
  fiscal_address: string | null
  giro: string | null
  phone: string | null
  email: string | null
  logo_url: string | null
  invoice_footer_note: string | null
}

export async function updateCompanySettings(
  input: CompanySettingsInput
): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }

  const id = await getSettingsId()
  const admin = createAdminClient()

  if (!id) {
    const { error } = await admin.from('company_settings').insert({
      legal_name: input.legal_name,
      trade_name: input.trade_name,
      nit: input.nit,
      nrc: input.nrc,
      fiscal_address: input.fiscal_address,
      giro: input.giro,
      phone: input.phone,
      email: input.email,
      logo_url: input.logo_url,
      invoice_footer_note: input.invoice_footer_note,
      updated_by: auth.userId,
    })
    if (error) return { error: 'Error al crear la configuración del emisor' as const }
  } else {
    const { error } = await admin
      .from('company_settings')
      .update({
        ...input,
        updated_by: auth.userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) return { error: 'Error al guardar la configuración del emisor' as const }
  }

  revalidatePath('/billing/settings')
  return { ok: true as const }
}

// ── Términos y condiciones ───────────────────────────────────

export async function upsertTermAndCondition(
  term: { id?: string; order: number; text: string }
): Promise<{ error: string } | { ok: true; id: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const id = await getSettingsId()
  if (!id) return { error: 'Configuración del emisor no inicializada' as const }

  const admin = createAdminClient()
  const { data: settings } = await admin.from('company_settings').select('terms_and_conditions_json').eq('id', id).single()
  const list: TermAndCondition[] = (settings?.terms_and_conditions_json ?? []) as TermAndCondition[]

  const termId = term.id ?? `tc_${Date.now().toString(36)}`
  const next = term.id
    ? list.map(t => t.id === term.id ? { ...t, order: term.order, text: term.text } : t)
    : [...list, { id: termId, order: term.order, text: term.text }]

  next.sort((a, b) => a.order - b.order)

  const { error } = await admin
    .from('company_settings')
    .update({ terms_and_conditions_json: next, updated_by: auth.userId, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: 'Error al guardar el término' as const }

  revalidatePath('/billing/settings')
  return { ok: true as const, id: termId }
}

export async function deleteTermAndCondition(
  termId: string
): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const id = await getSettingsId()
  if (!id) return { error: 'Configuración del emisor no inicializada' as const }

  const admin = createAdminClient()
  const { data: settings } = await admin.from('company_settings').select('terms_and_conditions_json').eq('id', id).single()
  const list: TermAndCondition[] = (settings?.terms_and_conditions_json ?? []) as TermAndCondition[]
  const next = list.filter(t => t.id !== termId)

  const { error } = await admin
    .from('company_settings')
    .update({ terms_and_conditions_json: next, updated_by: auth.userId, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: 'Error al eliminar el término' as const }

  revalidatePath('/billing/settings')
  return { ok: true as const }
}

export async function reorderTermsAndConditions(
  orderedIds: string[]
): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const id = await getSettingsId()
  if (!id) return { error: 'Configuración del emisor no inicializada' as const }

  const admin = createAdminClient()
  const { data: settings } = await admin.from('company_settings').select('terms_and_conditions_json').eq('id', id).single()
  const list: TermAndCondition[] = (settings?.terms_and_conditions_json ?? []) as TermAndCondition[]
  const byId = new Map(list.map(t => [t.id, t]))
  const next: TermAndCondition[] = orderedIds
    .map((tid, idx) => {
      const t = byId.get(tid)
      return t ? { ...t, order: idx + 1 } : null
    })
    .filter((t): t is TermAndCondition => t !== null)

  const { error } = await admin
    .from('company_settings')
    .update({ terms_and_conditions_json: next, updated_by: auth.userId, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: 'Error al reordenar los términos' as const }

  revalidatePath('/billing/settings')
  return { ok: true as const }
}

// ── Métodos de pago ──────────────────────────────────────────

export async function upsertPaymentMethod(
  method: PaymentMethodConfig
): Promise<{ error: string } | { ok: true; id: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const id = await getSettingsId()
  if (!id) return { error: 'Configuración del emisor no inicializada' as const }

  const admin = createAdminClient()
  const { data: settings } = await admin.from('company_settings').select('payment_methods_json').eq('id', id).single()
  const list: PaymentMethodConfig[] = (settings?.payment_methods_json ?? []) as PaymentMethodConfig[]

  const methodId = method.id || `pm_${Date.now().toString(36)}`
  const exists = list.some(m => m.id === methodId)
  const next = exists
    ? list.map(m => m.id === methodId ? { ...method, id: methodId } : m)
    : [...list, { ...method, id: methodId }]

  const { error } = await admin
    .from('company_settings')
    .update({ payment_methods_json: next, updated_by: auth.userId, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: 'Error al guardar el método de pago' as const }

  revalidatePath('/billing/settings')
  return { ok: true as const, id: methodId }
}

export async function deletePaymentMethod(
  methodId: string
): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const id = await getSettingsId()
  if (!id) return { error: 'Configuración del emisor no inicializada' as const }

  const admin = createAdminClient()
  const { data: settings } = await admin.from('company_settings').select('payment_methods_json').eq('id', id).single()
  const list: PaymentMethodConfig[] = (settings?.payment_methods_json ?? []) as PaymentMethodConfig[]
  const next = list.filter(m => m.id !== methodId)

  const { error } = await admin
    .from('company_settings')
    .update({ payment_methods_json: next, updated_by: auth.userId, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return { error: 'Error al eliminar el método de pago' as const }

  revalidatePath('/billing/settings')
  return { ok: true as const }
}
