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

// ── Cleanup global de jornadas y timers huérfanos ──────────────────────────
// Corre antes del billing. Cierra work_sessions y time_entries de TODOS los
// usuarios que quedaron abiertos overnight (browser cerrado sin finalizar).
try {
  await supabase.rpc('close_orphan_work_sessions', { p_user_id: null, p_older_than_hours: 14 })
  await supabase.rpc('truncate_anomalous_time_entries', { p_user_id: null, p_threshold_hours: 14 })
  console.log('[daily-cycle-runner] cleanup de jornadas huérfanas completado')
} catch (err) {
  console.error('[daily-cycle-runner] cleanup de jornadas falló (no crítico):', err)
}

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
  aplica_renta_retenida: boolean
  default_tax_rate: number | null
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

/**
 * ¿Está este ciclo realmente pagado (todas las facturas cubiertas)?
 * - monthly: payment_status === 'paid'
 * - biweekly: payment_status === 'paid' Y payment_status_2 === 'paid'
 *
 * NOTA: este check protege contra renovar a un cliente cuya segunda
 * quincena del biweekly NO está pagada — antes solo se revisaba la primera.
 */
function isCycleFullyPaid(
  cycle: { payment_status: string | null; payment_status_2: string | null },
  billingPeriod: 'monthly' | 'biweekly'
): boolean {
  if (cycle.payment_status !== 'paid') return false
  if (billingPeriod === 'biweekly' && cycle.payment_status_2 !== 'paid') return false
  return true
}

/**
 * Tipos de contenido que participan en el pipeline (debe coincidir con
 * `PIPELINE_CONTENT_TYPES` en `src/lib/domain/pipeline.ts`).
 */
const PIPELINE_CONTENT_TYPES = ['historia', 'estatico', 'video_corto', 'reel', 'short']

/**
 * Mueve requerimientos abiertos (no anulados, no en `publicado_entregado`)
 * del ciclo previo al nuevo. Cambia `billing_cycle_id` del registro original
 * y marca `carried_over=true`. NO crea copias — preserva chat, review,
 * time_entries y cambio_logs intactos al mantener el mismo `id`.
 *
 * NO inserta un phase_log de auditoría: hacerlo rompe el cálculo de
 * "tiempo en fase" porque last_moved_at usa el log más reciente.
 *
 * Equivalente inline a `migrateOpenPipelineItems()` en src/lib/domain/pipeline.ts;
 * duplicado porque el Edge Function corre en Deno y no puede importar src/.
 */
async function migrateOpenPipelineItemsInline(args: {
  previousCycleId: string
  newCycleId: string
}): Promise<number> {
  const { previousCycleId, newCycleId } = args

  const { data: openItems } = await supabase
    .from('requirements')
    .select('id')
    .eq('billing_cycle_id', previousCycleId)
    .eq('voided', false)
    .neq('phase', 'publicado_entregado')
    .in('content_type', PIPELINE_CONTENT_TYPES)

  if (!openItems || openItems.length === 0) return 0

  let migrated = 0
  for (const item of openItems as Array<{ id: string }>) {
    const { error: updErr } = await supabase
      .from('requirements')
      .update({ billing_cycle_id: newCycleId, carried_over: true })
      .eq('id', item.id)

    if (updErr) {
      console.error('[cron-migrate] update error', updErr)
      continue
    }

    migrated++
  }
  return migrated
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

/**
 * Llama a la CheckoutLink API de n1co para crear un link de pago para esta
 * factura. Si falta el secret o falla la llamada, retorna null y el caller
 * deja la factura en payment_provider='manual' (admin puede regenerar después).
 */
async function tryCreateN1coPaymentLink(args: {
  invoiceId: string
  invoiceNumber: string
  amount: number
  clientId: string
  clientName: string
  planName: string
  cycleId: string
  periodLabel: string
}): Promise<{ url: string; orderId: number; shortId: string | null } | null> {
  const checkoutSecret = Deno.env.get('N1CO_CHECKOUT_LINK_SECRET')
  if (!checkoutSecret) return null

  const env = Deno.env.get('N1CO_ENVIRONMENT') ?? 'sandbox'
  const payBaseUrl = env === 'production'
    ? 'https://api-pay.n1co.shop/api'
    : 'https://api-pay-sandbox.n1co.shop/api'
  const appUrl = (Deno.env.get('NEXT_PUBLIC_APP_URL') ?? Deno.env.get('APP_URL') ?? 'https://fm-full-y-connect.vercel.app').replace(/\/$/, '')

  try {
    const res = await fetch(`${payBaseUrl}/paymentlink/checkout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${checkoutSecret}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        orderReference: args.invoiceId,
        orderName: `FM Communications · Plan ${args.planName} (${args.periodLabel})`,
        orderDescription: `Factura ${args.invoiceNumber} · Cliente: ${args.clientName}`,
        amount: args.amount,
        successUrl: `${appUrl}/n1co-callback?invoice=${encodeURIComponent(args.invoiceId)}&status=success`,
        cancelUrl: `${appUrl}/n1co-callback?invoice=${encodeURIComponent(args.invoiceId)}&status=cancel`,
        expirationMinutes: 4320,
        metadata: [
          { name: 'invoiceId', value: args.invoiceId },
          { name: 'invoiceNumber', value: args.invoiceNumber },
          { name: 'clientId', value: args.clientId },
          { name: 'cycleId', value: args.cycleId },
          { name: 'source', value: 'cron-auto-billing' },
        ],
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[cron-n1co] payment link error', res.status, body)
      return null
    }
    const json = await res.json() as { paymentLinkUrl: string; orderId: number; orderCode: string }
    const m = /\/pl\/([^/?#]+)/.exec(json.paymentLinkUrl)
    return {
      url: json.paymentLinkUrl,
      orderId: json.orderId,
      shortId: m ? m[1] : null,
    }
  } catch (err) {
    console.error('[cron-n1co] payment link exception', err)
    return null
  }
}

Deno.serve(async (_req) => {
  const today = todayStr()
  const log: string[] = []

  try {
    // ========== STEP 1: AUTO-BILLING ==========
    const { data: autoCycles } = await supabase
      .from('billing_cycles')
      .select('id, period_start, period_end, client_id, plan_id_snapshot, payment_status, payment_status_2, clients(*)')
      .eq('status', 'current')

    const emitter = await loadCompanySettings()

    for (const cycle of autoCycles ?? []) {
      const client = cycle.clients as ClientRow | null
      if (!client || !client.auto_billing) continue
      if (daysUntil(cycle.period_end) > AUTO_INVOICE_LEAD_DAYS) continue

      // GATE: no pre-crear el siguiente ciclo si el cliente tiene impagos en
      // el ciclo actual. Evita que clientes morosos sigan ciclo siguiente.
      if (!isCycleFullyPaid(cycle as { payment_status: string | null; payment_status_2: string | null }, client.billing_period)) {
        log.push(`⊘ Skip auto-billing para ${client.name}: ciclo actual con pagos pendientes`)
        continue
      }

      // ¿ya existe ciclo 'scheduled' para este cliente?
      const { data: existingScheduled } = await supabase
        .from('billing_cycles')
        .select('id, period_start, period_end, auto_billed_at')
        .eq('client_id', client.id)
        .eq('status', 'scheduled')
        .maybeSingle()

      // Si el scheduled cycle ya tiene auto_billed_at (manual o cron previo),
      // saltamos para evitar duplicar la factura.
      if (existingScheduled?.auto_billed_at) {
        log.push(`⊘ Skip: scheduled cycle de ${client.name} ya tiene factura (auto_billed_at)`)
        continue
      }

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

      // Biweekly: cobrar la mitad del plan mensual cada quincena.
      const quantity = 1
      const unit_price = half ? round2(plan.price_usd / 2) : plan.price_usd
      const subtotal = round2(quantity * unit_price)
      const taxRate = client.default_tax_rate ?? 0
      const retentionRate = client.aplica_renta_retenida ? 0.1 : 0
      const taxAmount = round2(subtotal * taxRate)
      const retencion = round2(subtotal * retentionRate)
      const total = round2(subtotal + taxAmount)
      const totalAPagar = round2(subtotal - retencion + taxAmount)

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
          due_date: scheduledPeriodStart,
          currency: 'USD',
          subtotal,
          discount_amount: 0,
          tax_rate: taxRate,
          tax_amount: taxAmount,
          retention_rate: retentionRate,
          retencion_renta_amount: retencion,
          total,
          total_a_pagar: totalAPagar,
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

      // Generar payment link de n1co para esta factura, así el cliente puede pagar
      // desde su portal sin esperar acción manual del admin.
      // El monto del link es total_a_pagar (con retención aplicada), no el total del DTE.
      const linkInfo = await tryCreateN1coPaymentLink({
        invoiceId: invInsert.id,
        invoiceNumber: numberRow as unknown as string,
        amount: totalAPagar,
        clientId: client.id,
        clientName: client.name,
        planName: plan.name,
        cycleId: scheduledCycleId,
        periodLabel: label,
      })

      if (linkInfo) {
        await supabase
          .from('invoices')
          .update({
            n1co_payment_link_url: linkInfo.url,
            n1co_payment_link_id: linkInfo.shortId ?? String(linkInfo.orderId),
            n1co_order_reference: invInsert.id,
            payment_provider: 'n1co_link',
          })
          .eq('id', invInsert.id)
        log.push(`✓ Factura + link n1co para ${client.name} (${half ?? 'monthly'})`)
      } else {
        // Fallback: factura queda en payment_provider='manual' (default).
        log.push(`✓ Factura auto-emitida para ${client.name} (${half ?? 'monthly'}) sin link n1co`)
      }

      // Marca el scheduled cycle como auto-facturado para bloquear duplicaciones
      // si el cron corre dos veces el mismo día.
      await supabase
        .from('billing_cycles')
        .update({ auto_billed_at: new Date().toISOString() })
        .eq('id', scheduledCycleId)
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

      const fullyPaid = isCycleFullyPaid(
        cycle as { payment_status: string | null; payment_status_2: string | null },
        client.billing_period ?? 'monthly'
      )

      if (fullyPaid) {
        // Archive current cycle
        await supabase
          .from('billing_cycles')
          .update({ status: 'archived' })
          .eq('id', cycle.id)

        // ¿Existe un ciclo scheduled? Promoverlo.
        const { data: scheduled } = await supabase
          .from('billing_cycles')
          .select('id, plan_id_snapshot')
          .eq('client_id', client.id)
          .eq('status', 'scheduled')
          .maybeSingle()

        let newCycleId: string | null = null

        if (scheduled) {
          await supabase
            .from('billing_cycles')
            .update({ status: 'current' })
            .eq('id', scheduled.id)
          newCycleId = scheduled.id

          // Si admin cambió el plan al renovar anticipadamente, actualizar
          // clients.current_plan_id ahora (no antes, porque el ciclo actual aún
          // estaba activo con el plan anterior).
          if (
            scheduled.plan_id_snapshot &&
            scheduled.plan_id_snapshot !== client.current_plan_id
          ) {
            await supabase
              .from('clients')
              .update({ current_plan_id: scheduled.plan_id_snapshot })
              .eq('id', client.id)
            log.push(`✓ Plan actualizado a ${scheduled.plan_id_snapshot} para cliente ${client.id}`)
          }

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
          const { data: inserted } = await supabase
            .from('billing_cycles')
            .insert({
              client_id: client.id,
              plan_id_snapshot: client.current_plan_id,
              limits_snapshot_json: limitsSnapshot,
              rollover_from_previous_json: null,
              period_start: periodStart,
              period_end: periodEnd,
              status: 'current',
              payment_status: 'unpaid',
            })
            .select('id')
            .single()
          newCycleId = inserted?.id ?? null
          log.push(
            `✓ Renewed cycle for client ${client.id} (${periodStart} → ${periodEnd}, no scheduled)`
          )
        }

        // CRÍTICO: trasladar requerimientos abiertos del ciclo viejo al nuevo
        // ANTES de hacer cleanup de adjuntos. Si esto se omite, los reqs en
        // proceso desaparecen del pipeline / detalle de cliente.
        if (newCycleId) {
          try {
            const migrated = await migrateOpenPipelineItemsInline({
              previousCycleId: cycle.id,
              newCycleId,
            })
            if (migrated > 0) {
              log.push(`✓ ${migrated} requerimiento(s) trasladados al nuevo ciclo de ${client.name}`)
            }
          } catch (migErr) {
            log.push(`⚠ Migración falló para cliente ${client.id}: ${String(migErr)}`)
          }
        }

        // Cleanup de adjuntos del chat — Supabase Free solo permite 50MB total.
        // Como los reqs trasladados ya cambiaron de billing_cycle_id, esta query
        // solo encuentra los que QUEDARON en el ciclo archivado (publicado,
        // anulados, o tipos no-pipeline). Sus adjuntos sí se pueden borrar.
        try {
          const { data: reqsOfCycle } = await supabase
            .from('requirements')
            .select('id')
            .eq('billing_cycle_id', cycle.id)
          for (const r of (reqsOfCycle ?? []) as Array<{ id: string }>) {
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
      } else {
        // Unpaid (incluye biweekly con segunda quincena impaga) → pending_renewal + overdue
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
