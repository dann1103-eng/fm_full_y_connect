'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { nextCycleDates } from '@/lib/domain/cycles'
import { today as todayString } from '@/lib/domain/dates'
import { CONTENT_TYPES, CONTENT_TO_PLAN_KEY, effectiveLimits } from '@/lib/domain/plans'
import { computeTotals } from '@/lib/domain/requirement'
import { migrateOpenPipelineItems } from '@/lib/domain/pipeline'
import { cleanupCycleStorage } from '@/lib/supabase/cleanup-cycle-storage'
import type {
  BillingPeriod, CambiosPackage, ContentType, ExtraContentItem, PlanLimits,
} from '@/types/db'

interface RenewArgs {
  cycleId: string
  clientId: string
  planId: string
  billingPeriod: BillingPeriod
  rolloverChecked: Partial<Record<ContentType, boolean>>
  cambiosPackages: CambiosPackage[]
  extraContent: ExtraContentItem[]
  withChanges: boolean
}

export async function renewCycle(args: RenewArgs) {
  const supabase = await createClient()

  const [{ data: cycleRow }, { data: clientRow }, { data: planRow }, { data: reqs }] = await Promise.all([
    supabase.from('billing_cycles').select('*').eq('id', args.cycleId).single(),
    supabase.from('clients').select('*, plan:plans!clients_current_plan_id_fkey(*)').eq('id', args.clientId).single(),
    supabase.from('plans').select('*').eq('id', args.planId).single(),
    supabase.from('requirements').select('*').eq('billing_cycle_id', args.cycleId),
  ])

  if (!cycleRow || !clientRow || !planRow) {
    return { error: 'No se pudo cargar el ciclo actual.' }
  }

  const totals = computeTotals(reqs ?? [])
  const limits = effectiveLimits(cycleRow.limits_snapshot_json, cycleRow.rollover_from_previous_json)

  const planLimits: PlanLimits = planRow.unified_content_limit != null
    ? { ...planRow.limits_json, unified_content_limit: planRow.unified_content_limit }
    : planRow.limits_json

  const rolloverJson: Partial<PlanLimits> = {}
  let hasRollover = false
  for (const type of CONTENT_TYPES) {
    if (args.rolloverChecked[type]) {
      const unused = limits[type] - totals[type]
      if (unused > 0) {
        rolloverJson[CONTENT_TO_PLAN_KEY[type]] = unused
        hasRollover = true
      }
    }
  }

  const { periodStart, periodEnd } = nextCycleDates(cycleRow.period_end, {
    billingPeriod: args.billingPeriod,
  })

  const [{ error: archiveErr }, { error: clientErr }] = await Promise.all([
    supabase.from('billing_cycles').update({ status: 'archived' }).eq('id', args.cycleId),
    supabase.from('clients').update({
      status: 'active',
      ...(args.withChanges && args.planId !== clientRow.current_plan_id ? { current_plan_id: args.planId } : {}),
      ...(args.withChanges && args.billingPeriod !== clientRow.billing_period ? { billing_period: args.billingPeriod } : {}),
    }).eq('id', args.clientId),
  ])

  if (archiveErr || clientErr) return { error: 'Error al archivar el ciclo anterior.' }

  const { data: newCycle, error: insertErr } = await supabase
    .from('billing_cycles')
    .insert({
      client_id: args.clientId,
      plan_id_snapshot: args.planId,
      limits_snapshot_json: planLimits,
      rollover_from_previous_json: hasRollover ? rolloverJson : null,
      period_start: periodStart,
      period_end: periodEnd,
      status: 'current',
      payment_status: 'unpaid',
      cambios_budget: planRow.cambios_included + (args.withChanges ? args.cambiosPackages.reduce((s, p) => s + p.qty, 0) : 0),
      cambios_packages_json: args.withChanges ? args.cambiosPackages : [],
      extra_content_json: args.withChanges ? args.extraContent : [],
    })
    .select('id')
    .single()

  if (insertErr || !newCycle?.id) return { error: 'Error al crear el nuevo ciclo.' }

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    await migrateOpenPipelineItems(supabase, {
      previousCycleId: args.cycleId,
      newCycleId: newCycle.id,
      movedBy: user.id,
    })
  }

  // Limpiar storage de los reqs que NO migraron (se quedaron en el ciclo archivado).
  // Los que sí migraron cambiaron su billing_cycle_id al nuevo ciclo y aún están
  // en trabajo activo — sus archivos deben conservarse.
  const { data: remainingReqs } = await supabase
    .from('requirements')
    .select('id')
    .eq('billing_cycle_id', args.cycleId)
  const remainingIds = (remainingReqs ?? []).map((r) => r.id)
  if (remainingIds.length > 0) {
    await cleanupCycleStorage(supabase, remainingIds)
  }

  revalidatePath('/renewals')
  revalidatePath(`/clients/${args.clientId}`)
  revalidatePath('/dashboard')

  return { ok: true }
}

export async function markCyclePaid(cycleId: string, clientId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('billing_cycles')
    .update({ payment_status: 'paid', payment_date: todayString() })
    .eq('id', cycleId)

  if (error) return { error: 'Error al marcar el ciclo como pagado.' }

  revalidatePath('/renewals')
  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/dashboard')
  return { ok: true }
}

export async function pauseClient(clientId: string, cycleId: string) {
  const supabase = await createClient()
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabase.from('clients').update({ status: 'paused' }).eq('id', clientId),
    supabase.from('billing_cycles').update({ status: 'archived' }).eq('id', cycleId),
  ])

  if (e1 || e2) return { error: 'Error al pausar al cliente.' }

  // Limpiar todos los archivos del ciclo pausado (no hay migración, todo queda archivado)
  const { data: pausedReqs } = await supabase
    .from('requirements')
    .select('id')
    .eq('billing_cycle_id', cycleId)
  const pausedIds = (pausedReqs ?? []).map((r) => r.id)
  if (pausedIds.length > 0) {
    await cleanupCycleStorage(supabase, pausedIds)
  }

  revalidatePath('/renewals')
  revalidatePath(`/clients/${clientId}`)
  revalidatePath('/clients')
  revalidatePath('/dashboard')
  return { ok: true }
}
