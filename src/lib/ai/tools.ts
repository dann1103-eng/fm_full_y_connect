import type { SupabaseClient } from '@supabase/supabase-js'

// Tools que se exponen al modelo en el handler whatsapp_reply.
// Filtradas en runtime por wa_bot_configs.enabled_tools.

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

export const TOOL_DEFS: Record<string, ToolDef> = {
  get_client_context: {
    name: 'get_client_context',
    description:
      'Obtén información básica del cliente vinculado a esta conversación: nombre, plan actual, estado, redes sociales y notas internas. Úsalo al iniciar la conversación para personalizar el tono. Devuelve null si la conversación aún no está vinculada a un cliente.',
    input_schema: { type: 'object', properties: {} },
  },
  get_active_requirements: {
    name: 'get_active_requirements',
    description:
      'Lista los requerimientos del cliente que están en revisión por su parte (fase revision_cliente) o pendientes de publicación. Incluye título, tipo de contenido, fase y deadline.',
    input_schema: { type: 'object', properties: {} },
  },
  get_requirement_status: {
    name: 'get_requirement_status',
    description:
      'Obtén el detalle de UN requerimiento específico por id, incluyendo fase actual, último movimiento, número de cambios usados y deadline.',
    input_schema: {
      type: 'object',
      properties: { requirement_id: { type: 'string', description: 'UUID del requirement' } },
      required: ['requirement_id'],
    },
  },
  get_unpaid_invoices: {
    name: 'get_unpaid_invoices',
    description:
      'Lista las facturas del cliente con estado pendiente de pago.',
    input_schema: { type: 'object', properties: {} },
  },
  get_next_publications: {
    name: 'get_next_publications',
    description:
      'Devuelve los próximos eventos del calendario del cliente (publicaciones agendadas, reuniones) en los siguientes N días (default 14).',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Ventana en días, máximo 60', minimum: 1, maximum: 60 } },
    },
  },
  handoff_to_human: {
    name: 'handoff_to_human',
    description:
      'Pausa el bot en esta conversación y avisa al equipo. Úsalo cuando el cliente pida hablar con humano o el tema esté fuera de tu alcance.',
    input_schema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Motivo breve (visible al equipo)' } },
      required: ['reason'],
    },
  },
}

export const TOOL_FNS: Record<string, ToolFn> = {
  get_client_context: async (ctx) => {
    if (!ctx.clientId) return { linked: false, message: 'Conversación sin cliente vinculado.' }
    const { data } = await ctx.supabase
      .from('clients')
      .select('id, name, status, ig_handle, fb_handle, tiktok_handle, notes, plans:current_plan_id ( name )')
      .eq('id', ctx.clientId)
      .maybeSingle()
    if (!data) return { linked: false }
    const row = data as unknown as {
      id: string; name: string; status: string
      ig_handle: string | null; fb_handle: string | null; tiktok_handle: string | null
      notes: string | null
      plans: { name: string } | null
    }
    return {
      linked: true,
      id: row.id,
      name: row.name,
      status: row.status,
      plan: row.plans?.name ?? null,
      socials: { instagram: row.ig_handle, facebook: row.fb_handle, tiktok: row.tiktok_handle },
      notes: row.notes,
    }
  },

  get_active_requirements: async (ctx) => {
    if (!ctx.clientId) return { items: [], note: 'Conversación sin cliente vinculado.' }
    const { data } = await ctx.supabase
      .from('requirements')
      .select('id, title, content_type, phase, deadline, review_started_at, billing_cycles!inner ( client_id, status )')
      .eq('billing_cycles.client_id', ctx.clientId)
      .in('phase', ['revision_cliente', 'pendiente_publicar', 'aprobado'])
      .eq('approval_status', 'approved')
      .order('deadline', { ascending: true, nullsFirst: false })
      .limit(20)

    const items = (data ?? []).map((r) => {
      const row = r as unknown as {
        id: string; title: string | null; content_type: string
        phase: string; deadline: string | null; review_started_at: string | null
      }
      return {
        id: row.id,
        title: row.title || '(sin título)',
        content_type: row.content_type,
        phase: row.phase,
        deadline: row.deadline,
        review_started_at: row.review_started_at,
      }
    })
    return { items, count: items.length }
  },

  get_requirement_status: async (ctx, input) => {
    const id = String(input.requirement_id ?? '')
    if (!id) return { error: 'Falta requirement_id' }
    const { data } = await ctx.supabase
      .from('requirements')
      .select('id, title, content_type, phase, deadline, cambios_count, billing_cycles!inner ( client_id )')
      .eq('id', id)
      .maybeSingle()
    if (!data) return { error: 'No encontrado' }
    const row = data as unknown as {
      id: string; title: string | null; content_type: string
      phase: string; deadline: string | null; cambios_count: number
      billing_cycles?: { client_id: string }
    }
    if (ctx.clientId && row.billing_cycles?.client_id && row.billing_cycles.client_id !== ctx.clientId) {
      return { error: 'Ese requerimiento no pertenece a este cliente.' }
    }
    return {
      id: row.id,
      title: row.title || '(sin título)',
      content_type: row.content_type,
      phase: row.phase,
      deadline: row.deadline,
      cambios_used: row.cambios_count,
    }
  },

  get_unpaid_invoices: async (ctx) => {
    if (!ctx.clientId) return { items: [], note: 'Conversación sin cliente vinculado.' }
    const { data } = await ctx.supabase
      .from('invoices')
      .select('id, invoice_number, total, total_a_pagar, issue_date, due_date, status, payment_date')
      .eq('client_id', ctx.clientId)
      .eq('status', 'issued')
      .is('payment_date', null)
      .order('issue_date', { ascending: false })
      .limit(10)
    return { items: data ?? [], count: (data ?? []).length }
  },

  get_next_publications: async (ctx, input) => {
    if (!ctx.clientId) return { items: [], note: 'Conversación sin cliente vinculado.' }
    const days = Math.max(1, Math.min(60, Number(input.days ?? 14)))
    const now = new Date()
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)

    const { data } = await ctx.supabase
      .from('requirements')
      .select('id, title, content_type, phase, deadline, starts_at, billing_cycles!inner ( client_id )')
      .eq('billing_cycles.client_id', ctx.clientId)
      .or(`deadline.gte.${now.toISOString()},starts_at.gte.${now.toISOString()}`)
      .or(`deadline.lte.${until.toISOString()},starts_at.lte.${until.toISOString()}`)
      .neq('approval_status', 'rejected')
      .order('deadline', { ascending: true, nullsFirst: false })
      .limit(30)
    return { items: data ?? [], count: (data ?? []).length, window_days: days }
  },

  handoff_to_human: async (ctx, input) => {
    const reason = String(input.reason ?? '').slice(0, 500)
    await ctx.supabase
      .from('wa_conversations')
      .update({ bot_paused: true, paused_at: new Date().toISOString(), unread_count: 1 })
      .eq('id', ctx.conversationId)
    return { ok: true, paused: true, reason }
  },
}

export function filterEnabled(enabled: string[]): ToolDef[] {
  return enabled.map((name) => TOOL_DEFS[name]).filter((t): t is ToolDef => !!t)
}
