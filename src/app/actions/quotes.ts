'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildClientSnapshot,
  buildEmitterSnapshot,
  calculateTotals,
  type LineItemInput,
} from '@/lib/domain/invoices'
import { today as todayString } from '@/lib/domain/dates'
import type { Client, CompanySettings, Quote, QuoteItem, TermAndCondition } from '@/types/db'
import { createInvoice } from './invoices'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' as const }
  const { data: appUser } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'admin') return { error: 'Solo admins pueden gestionar cotizaciones' as const }
  return { userId: user.id }
}

async function loadEmitter(): Promise<CompanySettings | null> {
  const admin = createAdminClient()
  const { data } = await admin.from('company_settings').select('*').limit(1).maybeSingle()
  return data as CompanySettings | null
}

export interface CreateQuoteInput {
  clientId: string
  items: LineItemInput[]
  taxRate: number
  discountAmount?: number
  validUntil?: string | null
  notes?: string | null
}

export async function createQuote(
  input: CreateQuoteInput
): Promise<
  | { error: string }
  | { ok: true; quoteId: string; quoteNumber: string }
> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }

  if (!input.clientId) return { error: 'Cliente requerido' as const }
  if (!input.items?.length) return { error: 'La cotización debe tener al menos un ítem' as const }

  const admin = createAdminClient()

  const [{ data: clientRow }, emitter] = await Promise.all([
    admin.from('clients').select('*').eq('id', input.clientId).single(),
    loadEmitter(),
  ])
  const client = clientRow as Client | null
  if (!client) return { error: 'Cliente no encontrado' as const }
  if (!emitter) return { error: 'Configuración del emisor no inicializada (company_settings)' as const }

  const totals = calculateTotals({
    items: input.items,
    tax_rate: input.taxRate,
    discount_amount: input.discountAmount ?? 0,
  })

  const { data: numberRow, error: numberErr } = await admin.rpc('next_quote_number')
  if (numberErr || !numberRow) return { error: 'Error al generar el correlativo' as const }
  const quoteNumber = numberRow as unknown as string

  const termsSnapshot: TermAndCondition[] = (emitter.terms_and_conditions_json ?? []) as TermAndCondition[]

  const { data: inserted, error: insertErr } = await admin
    .from('quotes')
    .insert({
      quote_number: quoteNumber,
      client_id: client.id,
      issue_date: todayString(),
      valid_until: input.validUntil ?? null,
      currency: 'USD',
      subtotal: totals.subtotal,
      discount_amount: totals.discount_amount,
      tax_rate: input.taxRate,
      tax_amount: totals.tax_amount,
      total: totals.total,
      status: 'draft',
      notes: input.notes ?? null,
      client_snapshot_json: buildClientSnapshot(client),
      emitter_snapshot_json: buildEmitterSnapshot(emitter),
      terms_snapshot_json: termsSnapshot,
      created_by: auth.userId,
    })
    .select('id')
    .single()

  if (insertErr || !inserted?.id) return { error: 'Error al crear la cotización' as const }

  const itemsPayload = totals.items.map(it => ({
    quote_id: inserted.id,
    description: it.description,
    quantity: it.quantity,
    unit_price: it.unit_price,
    line_total: it.line_total,
    sort_order: it.sort_order,
  }))

  const { error: itemsErr } = await admin.from('quote_items').insert(itemsPayload)
  if (itemsErr) {
    await admin.from('quotes').delete().eq('id', inserted.id)
    return { error: 'Error al guardar los ítems de la cotización' as const }
  }

  revalidatePath('/billing')
  revalidatePath('/billing/quotes')
  revalidatePath(`/billing/quotes/${inserted.id}`)
  return { ok: true as const, quoteId: inserted.id, quoteNumber }
}

export async function sendQuote(id: string): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()
  const { error } = await admin
    .from('quotes')
    .update({ status: 'sent' })
    .eq('id', id)
    .in('status', ['draft', 'sent'])
  if (error) return { error: 'Error al enviar la cotización' as const }
  revalidatePath('/billing/quotes')
  revalidatePath(`/billing/quotes/${id}`)
  return { ok: true as const }
}

export async function markQuoteAccepted(id: string): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()
  const { error } = await admin.from('quotes').update({ status: 'accepted' }).eq('id', id)
  if (error) return { error: 'Error al marcar la cotización como aceptada' as const }
  revalidatePath('/billing/quotes')
  revalidatePath(`/billing/quotes/${id}`)
  return { ok: true as const }
}

export async function markQuoteRejected(id: string): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()
  const { error } = await admin.from('quotes').update({ status: 'rejected' }).eq('id', id)
  if (error) return { error: 'Error al marcar la cotización como rechazada' as const }
  revalidatePath('/billing/quotes')
  revalidatePath(`/billing/quotes/${id}`)
  return { ok: true as const }
}

export async function deleteQuoteDraft(id: string): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()
  const { data: q } = await admin.from('quotes').select('status').eq('id', id).single()
  if (!q) return { error: 'Cotización no encontrada' as const }
  if (q.status !== 'draft') return { error: 'Solo se pueden eliminar borradores' as const }
  const { error } = await admin.from('quotes').delete().eq('id', id)
  if (error) return { error: 'Error al eliminar el borrador' as const }
  revalidatePath('/billing/quotes')
  return { ok: true as const }
}

/** Crea una factura a partir de una cotización aceptada y enlaza ambos registros. */
export async function convertQuoteToInvoice(
  quoteId: string
): Promise<{ error: string } | { ok: true; invoiceId: string; invoiceNumber: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()

  const { data: quoteRow } = await admin
    .from('quotes')
    .select('*, items:quote_items(*)')
    .eq('id', quoteId)
    .single()
  const quote = quoteRow as (Quote & { items: QuoteItem[] }) | null
  if (!quote) return { error: 'Cotización no encontrada' as const }
  if (quote.status !== 'accepted') return { error: 'Solo se pueden convertir cotizaciones aceptadas' as const }
  if (quote.converted_invoice_id) return { error: 'Esta cotización ya fue convertida en factura' as const }

  const items: LineItemInput[] = quote.items
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(it => ({
      description: it.description,
      quantity: Number(it.quantity),
      unit_price: Number(it.unit_price),
    }))

  const result = await createInvoice({
    clientId: quote.client_id,
    quoteId: quote.id,
    items,
    taxRate: Number(quote.tax_rate),
    discountAmount: Number(quote.discount_amount) || 0,
    notes: quote.notes,
  })
  if ('error' in result) return result

  await admin
    .from('quotes')
    .update({ converted_invoice_id: result.invoiceId })
    .eq('id', quote.id)

  revalidatePath('/billing/quotes')
  revalidatePath(`/billing/quotes/${quote.id}`)
  revalidatePath('/billing/invoices')
  revalidatePath(`/billing/invoices/${result.invoiceId}`)
  return { ok: true as const, invoiceId: result.invoiceId, invoiceNumber: result.invoiceNumber }
}
