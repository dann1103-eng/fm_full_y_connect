/**
 * daily-cycle-runner — Supabase Edge Function
 *
 * Schedule: once per day (configure in Supabase dashboard → Edge Functions → Schedules)
 * Cron expression: 0 6 * * *  (6:00 AM UTC)
 *
 * What it does:
 * 1. AUTO-BILLING (before expiration loop):
 *    Para cada cliente con auto_billing=true y ciclo 'current' cuyo period_end esté
 *    a ≤ 10 días, pre-crea el siguiente ciclo con status='scheduled' y emite la
 *    factura correspondiente:
 *      - monthly  → 1 factura (biweekly_half=null)
 *      - biweekly → 1 factura (biweekly_half='first'; la segunda se crea en
 *                   markInvoicePaid cuando se paga la primera).
 * 2. EXPIRATION:
 *    Finds all 'current' cycles whose period_end < today → closes them.
 *    - Si existe un ciclo 'scheduled' para ese cliente → el pre-creado se promueve
 *      a 'current' (y hereda el pago si la factura automática ya fue pagada).
 *    - Si no existe → comportamiento histórico: archivar y abrir uno nuevo (si
 *      payment_status='paid') o marcar overdue.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const AUTO_INVOICE_LEAD_DAYS = 10

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

function daysUntil(periodEnd: string): number {
  const end = new Date(periodEnd)
  const t = new Date(todayStr())
  const diff = end.getTime() - t.getTime()
  return Math.round(diff / (1000 * 60 * 60 * 24))
}

function addDaysISO(dateStr: string, n: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

function addMonthsClamped(dateStr: string, months: number): string {
  const d = new Date(dateStr)
  const originalDay = d.getDate()
  const shifted = new Date(d)
  shifted.setMonth(shifted.getMonth() + months)
  const lastDayOfShifted = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate()
  if (originalDay > lastDayOfShifted) shifted.setDate(lastDayOfShifted)
  return shifted.toISOString().split('T')[0]
}

function subDayISO(dateStr: string): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() - 1)
  return d.toISOString().split('T')[0]
}

function nextCycleDates(
  previousPeriodEnd: string,
  billingPeriod: 'monthly' | 'biweekly'
): { periodStart: string; periodEnd: string } {
  const periodStart = addDaysISO(previousPeriodEnd, 1)
  const periodEnd =
    billingPeriod === 'biweekly'
      ? addDaysISO(periodStart, 13)
      : subDayISO(addMonthsClamped(periodStart, 1))
  return { periodStart, periodEnd }
}

function periodLabel(
  periodStart: string,
  periodEnd: string,
  billingPeriod: 'monthly' | 'biweekly',
  half: 'first' | 'second' | null
): string {
  const start = new Date(periodStart)
  const end = new Date(periodEnd)
  const months = [
    'enero','febrero','marzo','abril','mayo','junio',
    'julio','agosto','septiembre','octubre','noviembre','diciembre',
  ]
  if (billingPeriod === 'biweekly' && half) {
    const sd = String(start.getDate()).padStart(2, '0')
    const ed = String(end.getDate()).padStart(2, '0')
    return `${sd} al ${ed} de ${months[start.getMonth()]}`
  }
  return `${months[start.getMonth()]} ${start.getFullYear()}`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

interface ClientRow {
  id: string
  name: string
  current_plan_id: string
  billing_period: 'monthly' | 'biweekly'
  auto_billing: boolean
  legal_name: string | null
  person_type: string | null
  nit: string | null
  nrc: string | null
  dui: string | null
  fiscal_address: string | null
  giro: string | null
  country_code: string | null
  contact_email: string | null
  contact_phone: string | null
}

async function loadCompanySettings() {
  const { data } = await supabase.from('company_settings').select('*').limit(1).maybeSingle()
  return data
}

function buildClientSnapshot(client: ClientRow) {
  return {
    id: client.id,
    name: client.name,
    legal_name: client.legal_name,
    person_type: client.person_type,
    nit: client.nit,
    nrc: client.nrc,
    dui: client.dui,
    fiscal_address: client.fiscal_address,
    giro: client.giro,
    country_code: client.country_code,
    contact_email: client.contact_email,
    contact_phone: client.contact_phone,
  }
}

function buildEmitterSnapshot(settings: Record<string, unknown> | null) {
  if (!settings) return {}
  return {
    legal_name: settings.legal_name,
    trade_name: settings.trade_name,
    nit: settings.nit,
    nrc: settings.nrc,
    fiscal_address: settings.fiscal_address,
    giro: settings.giro,
    phone: settings.phone,
    email: settings.email,
    logo_url: settings.logo_url,
    invoice_footer_note: settings.invoice_footer_note,
    payment_methods: settings.payment_methods_json ?? [],
  }
}

Deno.serve(async (_req) => {
  const today = todayStr()
  const log: string[] = []

  try {
    // ========== STEP 1: AUTO-BILLING ==========
    const { data: autoCycles } = await supabase
      .from('billing_cycles')
      .select('id, period_start, period_end, client_id, plan_id_snapshot, clients(*)')
      .eq('status', 'current')

    const emitter = await loadCompanySettings()

    for (const cycle of autoCycles ?? []) {
      const client = cycle.clients as ClientRow | null
      if (!client || !client.auto_billing) continue
      if (daysUntil(cycle.period_end) > AUTO_INVOICE_LEAD_DAYS) continue

      // ¿ya existe ciclo 'scheduled' para este cliente?
      const { data: existingScheduled } = await supabase
        .from('billing_cycles')
        .select('id, period_start, period_end')
        .eq('client_id', client.id)
        .eq('status', 'scheduled')
        .maybeSingle()

      let scheduledCycleId: string
      let scheduledPeriodStart: string
      let scheduledPeriodEnd: string

      if (existingScheduled) {
        scheduledCycleId = existingScheduled.id
        scheduledPeriodStart = existingScheduled.period_start
        scheduledPeriodEnd = existingScheduled.period_end
      } else {
        const { periodStart, periodEnd } = nextCycleDates(cycle.period_end, client.billing_period)
        const { data: plan } = await supabase
          .from('plans')
          .select('*')
          .eq('id', client.current_plan_id)
          .single()

        const baseSnapshot = plan?.limits_json ?? {}
        const limitsSnapshot =
          plan?.unified_content_limit != null
            ? { ...baseSnapshot, unified_content_limit: plan.unified_content_limit }
            : baseSnapshot

        const { data: inserted, error: insertErr } = await supabase
          .from('billing_cycles')
          .insert({
            client_id: client.id,
            plan_id_snapshot: client.current_plan_id,
            limits_snapshot_json: limitsSnapshot,
            rollover_from_previous_json: null,
            period_start: periodStart,
            period_end: periodEnd,
            status: 'scheduled',
            payment_status: 'unpaid',
          })
          .select('id')
          .single()

        if (insertErr || !inserted) {
          log.push(`✗ No se pudo crear ciclo scheduled para ${client.id}: ${String(insertErr?.message)}`)
          continue
        }
        scheduledCycleId = inserted.id
        scheduledPeriodStart = periodStart
        scheduledPeriodEnd = periodEnd
        log.push(`✓ Scheduled cycle creado para ${client.name} (${periodStart} → ${periodEnd})`)
      }

      // Determinar si ya existe factura 'first' (biweekly) o principal (monthly) para el scheduled cycle
      const { data: existingInvoices } = await supabase
        .from('invoices')
        .select('id, status, biweekly_half')
        .eq('billing_cycle_id', scheduledCycleId)
        .neq('status', 'void')

      const needsFirst = client.billing_period === 'biweekly'
        ? !(existingInvoices ?? []).some((i) => i.biweekly_half === 'first')
        : !(existingInvoices ?? []).some((i) => i.biweekly_half === null)

      if (!needsFirst) continue

      // Construir factura
      const { data: plan } = await supabase
        .from('plans')
        .select('name, price_usd')
        .eq('id', client.current_plan_id)
        .single()
      if (!plan) {
        log.push(`✗ Plan no encontrado para cliente ${client.id}`)
        continue
      }

      const half: 'first' | null = client.billing_period === 'biweekly' ? 'first' : null
      const label = periodLabel(scheduledPeriodStart, scheduledPeriodEnd, client.billing_period, half)
      const description = `Plan ${plan.name} — ${label}`

      const quantity = 1
      const unit_price = plan.price_usd
      const subtotal = round2(quantity * unit_price)
      const taxRate = 0
      const taxAmount = 0
      const total = subtotal

      const { data: numberRow, error: numberErr } = await supabase.rpc('next_invoice_number')
      if (numberErr || !numberRow) {
        log.push(`✗ Correlativo no generado para cliente ${client.id}`)
        continue
      }

      const { data: invInsert, error: invErr } = await supabase
        .from('invoices')
        .insert({
          invoice_number: numberRow as unknown as string,
          client_id: client.id,
          billing_cycle_id: scheduledCycleId,
          quote_id: null,
          issue_date: today,
          due_date: null,
          currency: 'USD',
          subtotal,
          discount_amount: 0,
          tax_rate: taxRate,
          tax_amount: taxAmount,
          total,
          status: 'issued',
          notes: null,
          client_snapshot_json: buildClientSnapshot(client),
          emitter_snapshot_json: buildEmitterSnapshot(emitter),
          created_by: null,
          biweekly_half: half,
        })
        .select('id')
        .single()

      if (invErr || !invInsert) {
        log.push(`✗ Factura no creada para cliente ${client.id}: ${String(invErr?.message)}`)
        continue
      }

      const { error: itemErr } = await supabase.from('invoice_items').insert({
        invoice_id: invInsert.id,
        description,
        quantity,
        unit_price,
        line_total: subtotal,
        sort_order: 0,
      })
      if (itemErr) {
        await supabase.from('invoices').delete().eq('id', invInsert.id)
        log.push(`✗ Items no guardados para factura ${invInsert.id}: ${String(itemErr.message)}`)
        continue
      }

      log.push(`✓ Factura auto-emitida para ${client.name} (${half ?? 'monthly'})`)
    }

    // ========== STEP 2: EXPIRE / RENEW CYCLES ==========
    const { data: expiredCycles, error: fetchError } = await supabase
      .from('billing_cycles')
      .select('*, clients(*)')
      .eq('status', 'current')
      .lt('period_end', today)

    if (fetchError) throw fetchError
    if (!expiredCycles || expiredCycles.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0, log }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    log.push(`Found ${expiredCycles.length} expired cycle(s)`)

    for (const cycle of expiredCycles) {
      const client = cycle.clients
      if (!client) continue

      if (cycle.payment_status === 'paid') {
        // Archive current cycle
        await supabase
          .from('billing_cycles')
          .update({ status: 'archived' })
          .eq('id', cycle.id)

        // Cleanup de adjuntos del chat — Supabase Free solo permite 50MB total.
        try {
          const { data: reqsOfCycle } = await supabase
            .from('requirements')
            .select('id')
            .eq('billing_cycle_id', cycle.id)
          for (const r of reqsOfCycle ?? []) {
            const { data: files } = await supabase.storage
              .from('requirement-attachments')
              .list(r.id)
            if (files && files.length > 0) {
              const paths = files.map((f: { name: string }) => `${r.id}/${f.name}`)
              await supabase.storage.from('requirement-attachments').remove(paths)
            }
          }
          log.push(`✓ Cleanup adjuntos para ciclo ${cycle.id}`)
        } catch (cleanupErr) {
          log.push(`⚠ Cleanup adjuntos falló: ${String(cleanupErr)}`)
        }

        // ¿Existe un ciclo scheduled? Promoverlo.
        const { data: scheduled } = await supabase
          .from('billing_cycles')
          .select('id')
          .eq('client_id', client.id)
          .eq('status', 'scheduled')
          .maybeSingle()

        if (scheduled) {
          await supabase
            .from('billing_cycles')
            .update({ status: 'current' })
            .eq('id', scheduled.id)
          log.push(`✓ Scheduled cycle promovido a current para cliente ${client.id}`)
        } else {
          // Fallback histórico: crear ciclo nuevo en 'current' con semántica existente.
          const { periodStart, periodEnd } = nextCycleDates(
            cycle.period_end,
            client.billing_period ?? 'monthly'
          )
          const { data: plan } = await supabase
            .from('plans')
            .select('*')
            .eq('id', client.current_plan_id)
            .single()
          const baseSnapshot = plan?.limits_json ?? cycle.limits_snapshot_json
          const limitsSnapshot =
            plan?.unified_content_limit != null
              ? { ...baseSnapshot, unified_content_limit: plan.unified_content_limit }
              : baseSnapshot
          await supabase.from('billing_cycles').insert({
            client_id: client.id,
            plan_id_snapshot: client.current_plan_id,
            limits_snapshot_json: limitsSnapshot,
            rollover_from_previous_json: null,
            period_start: periodStart,
            period_end: periodEnd,
            status: 'current',
            payment_status: 'unpaid',
          })
          log.push(`✓ Renewed cycle for client ${client.id} (paid, no scheduled)`)
        }
      } else {
        // Unpaid → mark as pending_renewal and client as overdue
        await supabase
          .from('billing_cycles')
          .update({ status: 'pending_renewal' })
          .eq('id', cycle.id)

        await supabase
          .from('clients')
          .update({ status: 'overdue' })
          .eq('id', client.id)

        log.push(`⚠ Client ${client.id} marked overdue (unpaid)`)
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed: expiredCycles.length, log }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error(err)
    return new Response(
      JSON.stringify({ ok: false, error: String(err), log }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
