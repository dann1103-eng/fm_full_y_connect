/**
 * daily-cycle-runner — Supabase Edge Function
 *
 * Schedule: once per day (configure in Supabase dashboard → Edge Functions → Schedules)
 * Cron expression: 0 6 * * *  (6:00 AM UTC)
 *
 * What it does:
 * 1. Finds all 'current' cycles whose period_end < today → closes them.
 *    - If payment_status = 'paid' → archives and opens a new cycle.
 *    - If payment_status = 'unpaid' → marks client 'overdue', cycle 'pending_renewal'.
 * 2. Marks clients as 'overdue' where they have a 'pending_renewal' cycle.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function nextCycleDates(
  previousPeriodEnd: string,
  billingDay: number
): { periodStart: string; periodEnd: string } {
  const prevEnd = new Date(previousPeriodEnd)
  const nextStart = new Date(prevEnd)
  nextStart.setDate(prevEnd.getDate() + 1)

  const year = nextStart.getFullYear()
  const month = nextStart.getMonth()

  const endMonth = month === 11 ? 0 : month + 1
  const endYear = month === 11 ? year + 1 : year
  const lastDay = lastDayOfMonth(endYear, endMonth + 1)
  const endDay = Math.min(billingDay - 1 < 1 ? lastDay : billingDay - 1, lastDay)

  const periodEnd =
    billingDay === 1
      ? new Date(year, month + 1, 0)
      : new Date(endYear, endMonth, endDay)

  return {
    periodStart: nextStart.toISOString().split('T')[0],
    periodEnd: periodEnd.toISOString().split('T')[0],
  }
}

Deno.serve(async (_req) => {
  const today = new Date().toISOString().split('T')[0]
  const log: string[] = []

  try {
    // Find expired 'current' cycles
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
        // Archive current cycle and open a new one
        await supabase
          .from('billing_cycles')
          .update({ status: 'archived' })
          .eq('id', cycle.id)

        const { periodStart, periodEnd } = nextCycleDates(
          cycle.period_end,
          client.billing_day
        )

        // Fetch latest plan snapshot
        const { data: plan } = await supabase
          .from('plans')
          .select('*')
          .eq('id', client.current_plan_id)
          .single()

        await supabase.from('billing_cycles').insert({
          client_id: client.id,
          plan_id_snapshot: client.current_plan_id,
          limits_snapshot_json: plan?.limits_json ?? cycle.limits_snapshot_json,
          rollover_from_previous_json: null,
          period_start: periodStart,
          period_end: periodEnd,
          status: 'current',
          payment_status: 'unpaid',
        })

        log.push(`✓ Renewed cycle for client ${client.id} (paid)`)
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
