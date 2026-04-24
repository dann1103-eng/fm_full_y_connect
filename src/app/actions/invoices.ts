'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildClientSnapshot,
  buildEmitterSnapshot,
  calculateTotals,
  suggestItemsFromPlan,
  type LineItemInput,
} from '@/lib/domain/invoices'
import { invoicePeriodLabel } from '@/lib/domain/billing'
import { nextCycleDates } from '@/lib/domain/cycles'
import { today as todayString } from '@/lib/domain/dates'
import type { Client, CompanySettings, InvoicePaymentMethod, Plan, BillingCycle } from '@/types/db'

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
  biweeklyHalf?: 'first' | 'second' | null
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
      biweekly_half: input.biweeklyHalf ?? null,
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
    .select('id, client_id, billing_cycle_id, biweekly_half')
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

  // Sincroniza con billing_cycles según biweekly_half.
  if (inv.billing_cycle_id) {
    const halfUpdate =
      inv.biweekly_half === 'second'
        ? { payment_status_2: 'paid' as const, payment_date_2: payDate }
        : inv.biweekly_half === 'first'
          ? { payment_status: 'paid' as const, payment_date: payDate }
          : {
              payment_status: 'paid' as const,
              payment_date: payDate,
              payment_status_2: 'paid' as const,
              payment_date_2: payDate,
            }
    await admin.from('billing_cycles').update(halfUpdate).eq('id', inv.billing_cycle_id)
    revalidatePath('/renewals')

    // Si fue la primera quincena: generar reactivamente la factura 'second' si no existe.
    if (inv.biweekly_half === 'first') {
      await generateBiweeklySecondIfNeeded({
        cycleId: inv.billing_cycle_id,
        clientId: inv.client_id,
        issuedBy: auth.userId,
      })
    }
  }

  revalidatePath('/billing')
  revalidatePath('/billing/invoices')
  revalidatePath(`/billing/invoices/${args.id}`)
  revalidatePath(`/clients/${inv.client_id}`)
  revalidatePath('/dashboard')
  return { ok: true as const }
}

async function generateBiweeklySecondIfNeeded(args: {
  cycleId: string
  clientId: string
  issuedBy: string
}) {
  const admin = createAdminClient()

  const { data: existingSecond } = await admin
    .from('invoices')
    .select('id')
    .eq('billing_cycle_id', args.cycleId)
    .eq('biweekly_half', 'second')
    .neq('status', 'void')
    .maybeSingle()
  if (existingSecond) return

  const [{ data: cycle }, { data: client }, emitter] = await Promise.all([
    admin
      .from('billing_cycles')
      .select('id, period_start, period_end, plan_id_snapshot')
      .eq('id', args.cycleId)
      .single(),
    admin.from('clients').select('*').eq('id', args.clientId).single(),
    loadEmitter(),
  ])
  if (!cycle || !client || !emitter) return

  const { data: plan } = await admin
    .from('plans')
    .select('*')
    .eq('id', (cycle as BillingCycle).plan_id_snapshot)
    .single()
  if (!plan) return

  // Computar periodo de la segunda quincena: medio del ciclo → period_end.
  const start = new Date((cycle as BillingCycle).period_start)
  const secondHalfStart = new Date(start)
  secondHalfStart.setDate(start.getDate() + 7)
  const secondStartISO = secondHalfStart.toISOString().split('T')[0]
  const secondEndISO = (cycle as BillingCycle).period_end

  const label = invoicePeriodLabel(secondStartISO, secondEndISO, 'biweekly', 'second')
  const items = suggestItemsFromPlan(plan as Plan, label)
  const totals = calculateTotals({ items, tax_rate: 0, discount_amount: 0 })

  const { data: numberRow, error: numberErr } = await admin.rpc('next_invoice_number')
  if (numberErr || !numberRow) return

  const { data: inserted, error: insertErr } = await admin
    .from('invoices')
    .insert({
      invoice_number: numberRow as unknown as string,
      client_id: (client as Client).id,
      billing_cycle_id: args.cycleId,
      quote_id: null,
      issue_date: todayString(),
      currency: 'USD',
      subtotal: totals.subtotal,
      discount_amount: totals.discount_amount,
      tax_rate: 0,
      tax_amount: totals.tax_amount,
      total: totals.total,
      status: 'issued',
      client_snapshot_json: buildClientSnapshot(client as Client),
      emitter_snapshot_json: buildEmitterSnapshot(emitter),
      created_by: null,
      biweekly_half: 'second',
    })
    .select('id')
    .single()
  if (insertErr || !inserted) return

  await admin.from('invoice_items').insert(
    totals.items.map((it) => ({
      invoice_id: inserted.id,
      description: it.description,
      quantity: it.quantity,
      unit_price: it.unit_price,
      line_total: it.line_total,
      sort_order: it.sort_order,
    }))
  )
  // El issuedBy queda registrado implícitamente por ser una acción del admin que pagó la 1ra.
  void args.issuedBy
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

/**
 * Devuelve el id de un billing_cycle con status='scheduled' para el cliente,
 * creándolo si no existe. Usado cuando el admin factura el "siguiente ciclo"
 * desde el InvoiceForm y aún no hay un scheduled pre-creado por el cron.
 */
export async function ensureScheduledCycle(
  clientId: string,
): Promise<{ error: string } | { ok: true; cycleId: string }> {
  const auth = await requireAdmin()
  if ('error' in auth) return { error: auth.error as string }
  const admin = createAdminClient()

  // Reusar si ya hay uno scheduled
  const { data: existing } = await admin
    .from('billing_cycles')
    .select('id')
    .eq('client_id', clientId)
    .eq('status', 'scheduled')
    .maybeSingle()
  if (existing?.id) return { ok: true as const, cycleId: existing.id as string }

  // Cargar cliente + ciclo actual + plan
  const [{ data: clientRow }, { data: currentRow }] = await Promise.all([
    admin.from('clients').select('*').eq('id', clientId).single(),
    admin
      .from('billing_cycles')
      .select('id, period_start, period_end')
      .eq('client_id', clientId)
      .eq('status', 'current')
      .maybeSingle(),
  ])
  const client = clientRow as Client | null
  const current = currentRow as Pick<BillingCycle, 'id' | 'period_start' | 'period_end'> | null
  if (!client) return { error: 'Cliente no encontrado' as const }
  if (!current) return { error: 'El cliente no tiene un ciclo activo' as const }

  const { data: planRow } = await admin
    .from('plans')
    .select('*')
    .eq('id', client.current_plan_id ?? '')
    .maybeSingle()
  const plan = planRow as Plan | null
  if (!plan) return { error: 'El cliente no tiene un plan asignado' as const }

  const { periodStart, periodEnd } = nextCycleDates(current.period_end, {
    billingPeriod: client.billing_period,
  })

  const snapshot = plan.unified_content_limit != null
    ? { ...(plan.limits_json ?? {}), unified_content_limit: plan.unified_content_limit }
    : plan.limits_json

  const { data: inserted, error } = await admin
    .from('billing_cycles')
    .insert({
      client_id: client.id,
      plan_id_snapshot: plan.id,
      limits_snapshot_json: snapshot,
      rollover_from_previous_json: null,
      period_start: periodStart,
      period_end: periodEnd,
      status: 'scheduled',
      payment_status: 'unpaid',
    })
    .select('id')
    .single()

  if (error || !inserted?.id) return { error: 'Error al crear el ciclo programado' as const }
  return { ok: true as const, cycleId: inserted.id as string }
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
