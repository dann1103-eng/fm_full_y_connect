import type { SupabaseClient } from '@supabase/supabase-js'
import { CLIENT_PHASE_MAP, CLIENT_PHASE_LABELS, type ClientPhase } from '@/lib/domain/pipeline'
import type { Phase } from '@/types/db'

// ──────────────────────────────────────────────────────────────
// Tools del bot de WhatsApp — diseñadas para ser CONCISAS (pocos
// tokens en schema y en respuestas) y siempre devolver fases
// "client-friendly" (las 5 fases visibles al cliente, no las 12
// internas del equipo).
// ──────────────────────────────────────────────────────────────

export interface ToolDef {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface ToolContext {
  supabase: SupabaseClient
  conversationId: string
  clientId: string | null
  phoneE164: string
}

export type ToolFn = (ctx: ToolContext, input: Record<string, unknown>) => Promise<unknown>

const NO_CLIENT = { error: 'Conversación sin cliente vinculado. Pide al usuario que un humano lo vincule, o usa handoff_to_human.' }

export const TOOL_DEFS: Record<string, ToolDef> = {
  get_client_context: {
    name: 'get_client_context',
    description:
      'Datos básicos del cliente: nombre, plan, estado y notas. Úsalo al inicio si lo necesitas para personalizar tono. NO lo llames si el usuario solo está saludando.',
    input_schema: { type: 'object', properties: {} },
  },
  get_requirements_summary: {
    name: 'get_requirements_summary',
    description:
      'Resumen del pipeline del cliente en el ciclo actual: cuántos contenidos hay en cada fase (En proceso, Revisión, Aprobado, Pendiente de publicar, Publicado). Úsalo cuando el cliente pregunte "cómo va mi contenido", "qué tienes pendiente", etc.',
    input_schema: { type: 'object', properties: {} },
  },
  get_requirements_by_phase: {
    name: 'get_requirements_by_phase',
    description:
      'Lista detallada de contenidos en una fase específica del cliente. Úsalo después de get_requirements_summary cuando el cliente pida ver los títulos de algún grupo (ej. "muéstrame los que están en revisión").',
    input_schema: {
      type: 'object',
      properties: {
        client_phase: {
          type: 'string',
          enum: ['diseno', 'revision_cliente', 'aprobado', 'pendiente_publicar', 'publicado'],
          description: 'La fase visible al cliente.',
        },
      },
      required: ['client_phase'],
    },
  },
  get_requirement_detail: {
    name: 'get_requirement_detail',
    description: 'Detalle de UN contenido específico por id (título, tipo, fase, deadline).',
    input_schema: {
      type: 'object',
      properties: { requirement_id: { type: 'string' } },
      required: ['requirement_id'],
    },
  },
  get_billing_status: {
    name: 'get_billing_status',
    description:
      'Estado del ciclo de facturación actual del cliente: fecha de inicio/fin, días restantes, estado de pago, periodo de gracia y nombre del plan. Úsalo para preguntas como "cuándo termina mi mes", "ya pagué", "días que me quedan".',
    input_schema: { type: 'object', properties: {} },
  },
  get_unpaid_invoices: {
    name: 'get_unpaid_invoices',
    description: 'Facturas emitidas sin pago. Devuelve número, monto y fechas.',
    input_schema: { type: 'object', properties: {} },
  },
  get_next_publications: {
    name: 'get_next_publications',
    description:
      'Próximas publicaciones agendadas en los siguientes N días (default 14, máximo 60). Usa el deadline o starts_at del requerimiento.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', minimum: 1, maximum: 60 } },
    },
  },
  handoff_to_human: {
    name: 'handoff_to_human',
    description:
      'Pausa el bot y avisa al equipo. Úsalo cuando: el cliente pida hablar con humano, quiera dar de baja el servicio, esté frustrado, el tema esté fuera de tu alcance, o pregunte algo sensible (pagos puntuales no aclarados, quejas, problemas de calidad).',
    input_schema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Motivo breve, visible al equipo' } },
      required: ['reason'],
    },
  },
  submit_lead_info: {
    name: 'submit_lead_info',
    description:
      'Guarda la información que has recolectado del prospecto. Llámalo cada vez que el lead te dé nuevos datos (nombre de la empresa/marca, qué servicios busca, presupuesto aproximado, urgencia, etc.). Puedes llamarlo varias veces durante la conversación para agregar info; solo pasa los campos NUEVOS o ACTUALIZADOS, no repitas los que ya guardaste. Esta info la verá el equipo cuando tome la conversación.',
    input_schema: {
      type: 'object',
      properties: {
        company_name: { type: 'string', description: 'Nombre de la empresa o marca del prospecto.' },
        contact_name: { type: 'string', description: 'Nombre de la persona con la que estás hablando.' },
        interest: { type: 'string', description: 'Qué servicio/s le interesan (contenido, redes, fotografía, video, etc.).' },
        budget_range: { type: 'string', description: 'Rango de presupuesto si lo mencionó (libre: "$300-500", "no sé aún", etc.).' },
        urgency: { type: 'string', description: 'Cuándo quiere empezar / qué tan urgente es.' },
        notes: { type: 'string', description: 'Otros datos relevantes que mencionó (audiencia objetivo, competencia, dolores específicos, etc.).' },
      },
    },
  },
}

// ──────────────────────────────────────────────────────────────
// Ejecutores — devuelven JSON pequeño y consistente.
// ──────────────────────────────────────────────────────────────

export const TOOL_FNS: Record<string, ToolFn> = {
  get_client_context: async (ctx) => {
    if (!ctx.clientId) return NO_CLIENT
    const { data } = await ctx.supabase
      .from('clients')
      .select('id, name, status, plans:current_plan_id ( name )')
      .eq('id', ctx.clientId)
      .maybeSingle()
    if (!data) return NO_CLIENT
    const row = data as unknown as {
      id: string; name: string; status: string
      plans: { name: string } | null
    }
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      plan: row.plans?.name ?? null,
    }
  },

  get_requirements_summary: async (ctx) => {
    if (!ctx.clientId) return NO_CLIENT
    const cycle = await getCurrentCycleId(ctx.supabase, ctx.clientId)
    if (!cycle) return { error: 'No hay ciclo activo.' }

    const { data } = await ctx.supabase
      .from('requirements')
      .select('phase')
      .eq('billing_cycle_id', cycle.id)
      .eq('approval_status', 'approved')
      .eq('voided', false)
      .limit(500)

    const counts: Record<ClientPhase, number> = {
      diseno: 0, revision_cliente: 0, aprobado: 0, pendiente_publicar: 0, publicado: 0,
    }
    for (const r of (data ?? []) as Array<{ phase: Phase }>) {
      const cp = CLIENT_PHASE_MAP[r.phase]
      if (cp) counts[cp]++
    }
    return {
      counts: Object.fromEntries(
        Object.entries(counts).map(([k, v]) => [k, { count: v, label: CLIENT_PHASE_LABELS[k as ClientPhase] }]),
      ),
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      cycle_id: cycle.id,
    }
  },

  get_requirements_by_phase: async (ctx, input) => {
    if (!ctx.clientId) return NO_CLIENT
    const clientPhase = String(input.client_phase ?? '') as ClientPhase
    const validPhases: ClientPhase[] = ['diseno', 'revision_cliente', 'aprobado', 'pendiente_publicar', 'publicado']
    if (!validPhases.includes(clientPhase)) return { error: 'client_phase inválida' }

    const internalPhases = (Object.keys(CLIENT_PHASE_MAP) as Phase[]).filter(
      (p) => CLIENT_PHASE_MAP[p] === clientPhase,
    )
    const cycle = await getCurrentCycleId(ctx.supabase, ctx.clientId)
    if (!cycle) return { items: [], note: 'No hay ciclo activo.' }

    const { data } = await ctx.supabase
      .from('requirements')
      .select('id, title, content_type, phase, deadline')
      .eq('billing_cycle_id', cycle.id)
      .eq('approval_status', 'approved')
      .eq('voided', false)
      .in('phase', internalPhases)
      .order('deadline', { ascending: true, nullsFirst: false })
      .limit(20)

    const items = (data ?? []).map((r) => {
      const row = r as { id: string; title: string | null; content_type: string; phase: Phase; deadline: string | null }
      return {
        id: row.id,
        title: row.title || `(${row.content_type})`,
        content_type: row.content_type,
        deadline: row.deadline,
      }
    })
    return { items, count: items.length, phase_label: CLIENT_PHASE_LABELS[clientPhase] }
  },

  get_requirement_detail: async (ctx, input) => {
    const id = String(input.requirement_id ?? '')
    if (!id) return { error: 'Falta requirement_id' }
    const { data } = await ctx.supabase
      .from('requirements')
      .select('id, title, content_type, phase, deadline, billing_cycles!inner ( client_id )')
      .eq('id', id)
      .maybeSingle()
    if (!data) return { error: 'No encontrado' }
    const row = data as unknown as {
      id: string; title: string | null; content_type: string; phase: Phase; deadline: string | null
      billing_cycles?: { client_id: string }
    }
    if (ctx.clientId && row.billing_cycles?.client_id && row.billing_cycles.client_id !== ctx.clientId) {
      return { error: 'Ese requerimiento no pertenece a este cliente.' }
    }
    const cp = CLIENT_PHASE_MAP[row.phase] ?? 'diseno'
    return {
      id: row.id,
      title: row.title || `(${row.content_type})`,
      content_type: row.content_type,
      client_phase: cp,
      phase_label: CLIENT_PHASE_LABELS[cp],
      deadline: row.deadline,
    }
  },

  get_billing_status: async (ctx) => {
    if (!ctx.clientId) return NO_CLIENT
    const { data } = await ctx.supabase
      .from('billing_cycles')
      .select('id, period_start, period_end, status, payment_status, payment_date, grace_period_until, no_expira, plans:plan_id_snapshot ( name )')
      .eq('client_id', ctx.clientId)
      .eq('status', 'current')
      .order('period_end', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!data) return { error: 'No hay ciclo activo.' }
    const row = data as unknown as {
      id: string; period_start: string; period_end: string
      status: string; payment_status: 'paid' | 'unpaid'; payment_date: string | null
      grace_period_until: string | null; no_expira: boolean
      plans: { name: string } | null
    }
    const today = new Date()
    const end = new Date(row.period_end)
    const msPerDay = 24 * 60 * 60 * 1000
    const daysRemaining = row.no_expira
      ? null
      : Math.max(0, Math.ceil((end.getTime() - today.getTime()) / msPerDay))
    return {
      plan: row.plans?.name ?? null,
      period_start: row.period_start,
      period_end: row.period_end,
      days_remaining: daysRemaining,
      no_expira: row.no_expira,
      payment_status: row.payment_status,
      payment_date: row.payment_date,
      grace_period_until: row.grace_period_until,
    }
  },

  get_unpaid_invoices: async (ctx) => {
    if (!ctx.clientId) return NO_CLIENT
    const { data } = await ctx.supabase
      .from('invoices')
      .select('id, invoice_number, total_a_pagar, issue_date, due_date')
      .eq('client_id', ctx.clientId)
      .eq('status', 'issued')
      .is('payment_date', null)
      .order('issue_date', { ascending: false })
      .limit(10)
    return { items: data ?? [], count: (data ?? []).length }
  },

  get_next_publications: async (ctx, input) => {
    if (!ctx.clientId) return NO_CLIENT
    const days = Math.max(1, Math.min(60, Number(input.days ?? 14)))
    const now = new Date()
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

    const { data } = await ctx.supabase
      .from('requirements')
      .select('id, title, content_type, phase, deadline, billing_cycles!inner ( client_id )')
      .eq('billing_cycles.client_id', ctx.clientId)
      .neq('approval_status', 'rejected')
      .eq('voided', false)
      .gte('deadline', now.toISOString().slice(0, 10))
      .lte('deadline', until.toISOString().slice(0, 10))
      .order('deadline', { ascending: true })
      .limit(20)

    const items = (data ?? []).map((r) => {
      const row = r as { id: string; title: string | null; content_type: string; phase: Phase; deadline: string | null }
      const cp = CLIENT_PHASE_MAP[row.phase] ?? 'diseno'
      return {
        id: row.id,
        title: row.title || `(${row.content_type})`,
        content_type: row.content_type,
        deadline: row.deadline,
        phase_label: CLIENT_PHASE_LABELS[cp],
      }
    })
    return { items, count: items.length, window_days: days }
  },

  handoff_to_human: async (ctx, input) => {
    const reason = String(input.reason ?? '').slice(0, 500)
    await ctx.supabase
      .from('wa_conversations')
      .update({ bot_paused: true, paused_at: new Date().toISOString(), unread_count: 1 })
      .eq('id', ctx.conversationId)

    // Si hay un lead asociado (sin cliente vinculado), márcalo como escalated.
    if (!ctx.clientId) {
      await ctx.supabase
        .from('wa_leads')
        .update({ status: 'escalated' })
        .eq('conversation_id', ctx.conversationId)
        .eq('status', 'active')
    }
    return { ok: true, paused: true, reason }
  },

  submit_lead_info: async (ctx, input) => {
    // Upsert por conversation_id — el bot puede llamar muchas veces para ir
    // acumulando datos del prospecto a lo largo de la conversación.
    const fields = ['company_name', 'contact_name', 'interest', 'budget_range', 'urgency', 'notes'] as const
    const update: Record<string, string> = {}
    for (const f of fields) {
      const v = input[f]
      if (typeof v === 'string' && v.trim()) update[f] = v.trim().slice(0, 500)
    }
    if (Object.keys(update).length === 0) {
      return { ok: false, error: 'No se pasaron campos válidos.' }
    }

    // ¿Ya existe lead? Upsert manual: select + insert/update.
    const existing = await ctx.supabase
      .from('wa_leads')
      .select('id')
      .eq('conversation_id', ctx.conversationId)
      .maybeSingle()

    if (existing.data) {
      const upd = await ctx.supabase
        .from('wa_leads')
        .update(update)
        .eq('id', (existing.data as { id: string }).id)
      if (upd.error) return { ok: false, error: upd.error.message }
    } else {
      const ins = await ctx.supabase
        .from('wa_leads')
        .insert({
          conversation_id: ctx.conversationId,
          phone_e164: ctx.phoneE164,
          ...update,
        })
      if (ins.error) return { ok: false, error: ins.error.message }
    }
    return { ok: true, saved_fields: Object.keys(update) }
  },
}

async function getCurrentCycleId(
  supabase: SupabaseClient,
  clientId: string,
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('client_id', clientId)
    .eq('status', 'current')
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { id: string } | null) ?? null
}

export function filterEnabled(enabled: string[]): ToolDef[] {
  return enabled.map((name) => TOOL_DEFS[name]).filter((t): t is ToolDef => !!t)
}
