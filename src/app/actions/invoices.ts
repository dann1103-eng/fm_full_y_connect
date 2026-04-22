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
import type { Client, CompanySettings, InvoicePaymentMethod } from '@/types/db'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' as const }
  const { data: appUser } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'admin') return { error: 'Solo admins pueden gestionar facturas' as const }
  return { userId: user.id }
}

async function loadEmitter() {
  const admin = createAdminClient()
  const { data } = await admin.from('company_settings').select('*').limit(1).maybeSingle()
  return data as CompanySettings | null
}

export interface CreateInvoiceInput {
  clientId: string
  billingCycleId?: string | null
  quoteId?: string | null
  items: LineItemInput[]
  taxRate: number
  discountAmount?: number
  dueDate?: string | null
  notes?: string | null
}

export async function createInvoice(
  input: CreateInvoiceInput
): Promise<
  | { error: string }
  | { ok: true; invoiceId: string; invoiceNumber: string }
> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }

  if (!input.clientId) return { error: 'Cliente requerido' as const }
  if (!input.items?.length) return { error: 'La factura debe tener al menos un ítem' as const }

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

  const { data: numberRow, error: numberErr } = await admin.rpc('next_invoice_number')
  if (numberErr || !numberRow) return { error: 'Error al generar el correlativo' as const }
  const invoiceNumber = numberRow as unknown as string

  const { data: inserted, error: insertErr } = await admin
    .from('invoices')
    .insert({
      invoice_number: invoiceNumber,
      client_id: client.id,
      billing_cycle_id: input.billingCycleId ?? null,
      quote_id: input.quoteId ?? null,
      issue_date: todayString(),
      due_date: input.dueDate ?? null,
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
      created_by: auth.userId,
    })
    .select('id')
    .single()

  if (insertErr || !inserted?.id) return { error: 'Error al crear la factura' as const }

  const itemsPayload = totals.items.map(it => ({
    invoice_id: inserted.id,
    description: it.description,
    quantity: it.quantity,
    unit_price: it.unit_price,
    line_total: it.line_total,
    sort_order: it.sort_order,
  }))

  const { error: itemsErr } = await admin.from('invoice_items').insert(itemsPayload)
  if (itemsErr) {
    await admin.from('invoices').delete().eq('id', inserted.id)
    return { error: 'Error al guardar los ítems de la factura' as const }
  }

  revalidatePath('/billing')
  revalidatePath('/billing/invoices')
  revalidatePath(`/billing/invoices/${inserted.id}`)
  return { ok: true as const, invoiceId: inserted.id, invoiceNumber }
}

export async function issueInvoice(id: string): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()
  const { error } = await admin
    .from('invoices')
    .update({ status: 'issued' })
    .eq('id', id)
    .eq('status', 'draft')
  if (error) return { error: 'Error al emitir la factura' as const }
  revalidatePath('/billing/invoices')
  revalidatePath(`/billing/invoices/${id}`)
  return { ok: true as const }
}

export async function markInvoicePaid(args: {
  id: string
  paymentMethod: InvoicePaymentMethod
  paymentDate?: string
  paymentReference?: string | null
}): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()

  const { data: inv } = await admin
    .from('invoices')
    .select('id, client_id, billing_cycle_id')
    .eq('id', args.id)
    .single()
  if (!inv) return { error: 'Factura no encontrada' as const }

  const payDate = args.paymentDate ?? todayString()
  const { error } = await admin
    .from('invoices')
    .update({
      status: 'paid',
      payment_method: args.paymentMethod,
      payment_date: payDate,
      payment_reference: args.paymentReference ?? null,
    })
    .eq('id', args.id)
  if (error) return { error: 'Error al marcar la factura como pagada' as const }

  // Sincroniza con billing_cycles si la factura está ligada a un ciclo.
  if (inv.billing_cycle_id) {
    await admin
      .from('billing_cycles')
      .update({ payment_status: 'paid', payment_date: payDate })
      .eq('id', inv.billing_cycle_id)
    revalidatePath('/renewals')
  }

  revalidatePath('/billing')
  revalidatePath('/billing/invoices')
  revalidatePath(`/billing/invoices/${args.id}`)
  revalidatePath(`/clients/${inv.client_id}`)
  revalidatePath('/dashboard')
  return { ok: true as const }
}

export async function voidInvoice(id: string, reason: string): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()
  const { error } = await admin
    .from('invoices')
    .update({
      status: 'void',
      void_reason: reason,
      void_by: auth.userId,
      void_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return { error: 'Error al anular la factura' as const }
  revalidatePath('/billing/invoices')
  revalidatePath(`/billing/invoices/${id}`)
  return { ok: true as const }
}

export async function deleteInvoiceDraft(id: string): Promise<{ error: string } | { ok: true }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()
  const { data: inv } = await admin.from('invoices').select('status').eq('id', id).single()
  if (!inv) return { error: 'Factura no encontrada' as const }
  if (inv.status !== 'draft') return { error: 'Solo se pueden eliminar borradores' as const }
  const { error } = await admin.from('invoices').delete().eq('id', id)
  if (error) return { error: 'Error al eliminar el borrador' as const }
  revalidatePath('/billing/invoices')
  return { ok: true as const }
}
