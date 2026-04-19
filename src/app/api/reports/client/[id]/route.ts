import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import { createElement, type JSXElementConstructor, type ReactElement } from 'react'
import { createClient } from '@/lib/supabase/server'
import { ClientCycleReport } from '@/components/reports/ClientCycleReport'
import type { ClientWithPlan, BillingCycle, Requirement } from '@/types/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const includeDetail = req.nextUrl.searchParams.get('detail') !== 'false'

  const supabase = await createClient()

  // Auth check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch client + plan
  const { data: clientRaw } = await supabase
    .from('clients')
    .select('*, plan:plans(id, name, price_usd, cambios_included, limits_json)')
    .eq('id', id)
    .single()

  if (!clientRaw) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  const client = clientRaw as ClientWithPlan

  // Fetch current cycle
  const { data: cycleRaw } = await supabase
    .from('billing_cycles')
    .select('*')
    .eq('client_id', id)
    .eq('status', 'current')
    .maybeSingle()

  if (!cycleRaw) return NextResponse.json({ error: 'No active cycle' }, { status: 404 })
  const cycle = cycleRaw as BillingCycle

  // Fetch requirements
  const { data: reqsRaw } = await supabase
    .from('requirements')
    .select('id, content_type, title, phase, cambios_count, voided')
    .eq('billing_cycle_id', cycle.id)
    .order('registered_at', { ascending: true })

  const requirements = (reqsRaw ?? []) as Requirement[]

  // Build filename
  const monthNames = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  const cycleStart = new Date(cycle.period_start)
  const slug = client.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  const month = monthNames[cycleStart.getMonth()]
  const year = cycleStart.getFullYear()
  const filename = `reporte-${slug}-${month}-${year}.pdf`

  const generatedAt = new Date().toLocaleDateString('es-SV', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const reportProps = {
    client: {
      name: client.name,
      contact_email: client.contact_email,
      contact_phone: client.contact_phone,
      ig_handle: client.ig_handle,
      plan: {
        name: client.plan.name,
        price_usd: client.plan.price_usd,
        cambios_included: client.plan.cambios_included,
      },
    },
    cycle: {
      period_start: cycle.period_start,
      period_end: cycle.period_end,
      payment_status: cycle.payment_status,
      limits_snapshot_json: cycle.limits_snapshot_json,
      rollover_from_previous_json: cycle.rollover_from_previous_json,
      extra_content_json: cycle.extra_content_json ?? [],
      cambios_budget: cycle.cambios_budget,
      cambios_packages_json: cycle.cambios_packages_json ?? [],
      content_limits_override_json: cycle.content_limits_override_json,
    },
    requirements,
    includeDetail,
    generatedAt,
  }

  const element = createElement(ClientCycleReport, reportProps) as unknown as ReactElement<DocumentProps, JSXElementConstructor<DocumentProps>>
  const buffer = await renderToBuffer(element)

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
