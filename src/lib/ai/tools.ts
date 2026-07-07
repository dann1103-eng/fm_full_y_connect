import type { SupabaseClient } from '@supabase/supabase-js'
import { CLIENT_PHASE_MAP, CLIENT_PHASE_LABELS, canRequestChangeForPhase, type ClientPhase } from '@/lib/domain/pipeline'
import type { ContentType, Phase } from '@/types/db'
import { checkRequestEligibilityForClient, createRequirementFromBot } from '@/lib/ai/requirementRequestHelpers'
import {
  sendPaymentLinkForClient,
  createExtraContentInvoiceForClient,
  createExtraCambiosInvoiceForClient,
  createRenewalInvoiceForClient,
} from '@/lib/ai/billingHelpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCambiosBalance } from '@/lib/domain/credits'
import { botPostMessage, FM_BOT_USER_ID } from '@/lib/bot'
import { isPlausibleDesiredDate } from '@/lib/ai/dates'

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
    description: 'Detalle de UN contenido específico por id (título, tipo, fase, deadline). Incluye cambios ya aplicados (cambios_count, informativo).',
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
  send_payment_link: {
    name: 'send_payment_link',
    description:
      'Genera y devuelve el enlace de pago (n1co) de la factura PENDIENTE del cliente para que pague por WhatsApp. Sin argumentos toma la factura emitida e impaga más reciente; opcionalmente un invoice_id específico. Úsalo cuando el cliente diga "quiero pagar", "pásame el link", "cómo pago mi factura". NO crea facturas. Si no hay facturas pendientes, avísale con amabilidad.',
    input_schema: {
      type: 'object',
      properties: { invoice_id: { type: 'string', description: 'Opcional: id de una factura específica.' } },
    },
  },
  create_extra_invoice: {
    name: 'create_extra_invoice',
    description:
      'EMITE una factura de un EXTRA de catálogo y devuelve su enlace de pago n1co. Precios FIJOS de catálogo: estático $15, video corto $20, reel $25, short $15; paquete de 5 cambios $25. IMPORTANTE: antes de llamarla DEBES confirmar con el cliente el ítem y el monto exacto ("voy a generar tu factura de X por $Y, ¿confirmas?") y llamarla SOLO si el cliente dice que sí — esto emite una factura fiscal REAL. Nunca inventes precios ni montos distintos al catálogo. Para renovar el plan NO uses esta tool (aún no disponible): usa handoff_to_human.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['content', 'cambios'], description: "'content' para contenido extra; 'cambios' para paquete(s) de 5 cambios." },
        content_type: { type: 'string', enum: ['estatico', 'video_corto', 'reel', 'short'], description: 'Requerido si kind=content.' },
        quantity: { type: 'number', description: 'Para content: unidades del contenido. Para cambios: número de paquetes de 5.' },
      },
      required: ['kind', 'quantity'],
    },
  },
  create_renewal_invoice: {
    name: 'create_renewal_invoice',
    description:
      'EMITE la factura de RENOVACIÓN del próximo ciclo del plan del cliente + su enlace de pago. Úsala cuando el cliente quiera renovar o pagar su próximo mes. IMPORTANTE: antes de llamarla confirma con el cliente que quiere renovar su plan ("voy a generar tu renovación del plan X, ¿confirmas?") — emite una factura fiscal real. Si la tool devuelve needs_human=true (plan quincenal/bimestral), NO insistas: usa handoff_to_human para que el equipo gestione la renovación.',
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
  check_request_eligibility: {
    name: 'check_request_eligibility',
    description:
      'Verifica si el cliente puede solicitar contenido nuevo y devuelve la disponibilidad en el ciclo actual. Úsalo SIEMPRE como primer paso cuando el cliente quiera pedir un contenido nuevo. Devuelve blockers (si los hay), días restantes del ciclo, estado de pago, y por cada tipo cuántos puede usar todavía. IMPORTANTE: si la respuesta trae "unified_pool" (no null), el cliente tiene un PAQUETE on-demand de "limit" contenidos de CUALQUIER tipo con "available" restantes — repórtaselo como una bolsa única ("te quedan N contenidos de cualquier tipo"), NO listes número por tipo (todos repiten el mismo cupo del pool). Si unified_pool es null, sí reporta por tipo.',
    input_schema: { type: 'object', properties: {} },
  },
  create_requirement_request: {
    name: 'create_requirement_request',
    description:
      'Crea una solicitud de contenido nuevo en nombre del cliente. Llámala SOLO después de: (1) confirmar con check_request_eligibility que puede solicitar y que hay disponibilidad del tipo pedido, (2) haber recolectado del cliente título, fecha deseada y opcionalmente descripción y si quiere historia adicional. La solicitud queda con estado "pendiente de aprobación" para que el equipo la revise.',
    input_schema: {
      type: 'object',
      properties: {
        content_type: {
          type: 'string',
          enum: ['historia', 'estatico', 'video_corto', 'reel', 'short', 'produccion', 'reunion'],
          description: 'Tipo de contenido a solicitar.',
        },
        title: { type: 'string', description: 'Título breve y descriptivo (lo verá el equipo).' },
        desired_at: {
          type: 'string',
          description:
            'Fecha deseada. Para reunion o produccion: ISO datetime "YYYY-MM-DDTHH:MM" (necesita hora). Para los demás: fecha "YYYY-MM-DD".',
        },
        description: { type: 'string', description: 'Notas adicionales del cliente (estilo, referencias, contexto, dudas).' },
        includes_story: {
          type: 'boolean',
          description: 'Si quiere incluir una historia adicional. Solo válido para estatico, video_corto, reel o short.',
        },
      },
      required: ['content_type', 'title', 'desired_at'],
    },
  },
  get_changes_balance: {
    name: 'get_changes_balance',
    description:
      'Cuántos cambios le quedan al cliente en el MES (pool del plan + créditos extra). Úsalo cuando el cliente pregunte por cambios o ANTES de registrar una solicitud de cambio. Devuelve: included (cupo del plan), used (ya aprobados), remaining_cycle, extra_credits, total_available y pending (cambios ya pedidos sin aprobar aún).',
    input_schema: { type: 'object', properties: {} },
  },
  request_requirement_change: {
    name: 'request_requirement_change',
    description:
      'Registra una SOLICITUD de cambio del cliente sobre un contenido existente (no lo aplica; el equipo lo revisa y aplica). Antes de llamarla: (1) identifica el requirement_id correcto (usa get_requirements_by_phase / get_requirement_detail), (2) verifica con get_changes_balance que total_available > 0. Si no hay cambios disponibles, NO la llames: explica que se agotaron y ofrece escalar.',
    input_schema: {
      type: 'object',
      properties: {
        requirement_id: { type: 'string' },
        change_notes: { type: 'string', description: 'OBLIGATORIO. Justificación/descripción de qué quiere cambiar el cliente, en sus palabras. El supervisor de FM la usa para aprobar o rechazar; nunca registres un cambio sin esto.' },
      },
      required: ['requirement_id', 'change_notes'],
    },
  },
  request_reschedule: {
    name: 'request_reschedule',
    description:
      'Registra una SOLICITUD del cliente para reprogramar la fecha de un contenido ya solicitado (no cambia la fecha real; el equipo confirma). Necesita requirement_id y la nueva fecha. Para reunión/producción usa "YYYY-MM-DDTHH:MM"; para los demás "YYYY-MM-DD".',
    input_schema: {
      type: 'object',
      properties: {
        requirement_id: { type: 'string' },
        new_desired_date: { type: 'string', description: 'Nueva fecha deseada (YYYY-MM-DD o YYYY-MM-DDTHH:MM).' },
        reason: { type: 'string', description: 'Motivo del cambio de fecha (opcional).' },
      },
      required: ['requirement_id', 'new_desired_date'],
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
      .select('id, title, content_type, phase, deadline, cambios_count, billing_cycles!inner ( client_id )')
      .eq('id', id)
      .maybeSingle()
    if (!data) return { error: 'No encontrado' }
    const row = data as unknown as {
      id: string; title: string | null; content_type: string; phase: Phase; deadline: string | null
      cambios_count: number | null
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
      cambios_count: row.cambios_count ?? 0,
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

  send_payment_link: async (ctx, input) => {
    if (!ctx.clientId) return NO_CLIENT
    const invoiceId = input.invoice_id ? String(input.invoice_id) : undefined
    const res = await sendPaymentLinkForClient(ctx.clientId, invoiceId)
    if ('error' in res) return { error: res.error }
    return {
      ok: true,
      invoice_number: res.invoiceNumber,
      amount: res.totalAPagar,
      payment_link: res.paymentLinkUrl,
      message: `Enlace de pago listo. Compártelo con el cliente: ${res.paymentLinkUrl}`,
    }
  },

  create_extra_invoice: async (ctx, input) => {
    if (!ctx.clientId) return NO_CLIENT
    const kind = String(input.kind ?? '')
    const quantity = Number(input.quantity ?? 0)

    if (kind === 'content') {
      const ct = String(input.content_type ?? '') as ContentType
      if (!['estatico', 'video_corto', 'reel', 'short'].includes(ct)) {
        return { error: 'content_type inválido para un extra (estatico|video_corto|reel|short).' }
      }
      const res = await createExtraContentInvoiceForClient(ctx.clientId, ct, quantity)
      if ('error' in res) return { error: res.error }
      return {
        ok: true,
        invoice_number: res.invoiceNumber,
        amount: res.totalAPagar,
        payment_link: res.paymentLinkUrl,
        message: res.paymentLinkUrl
          ? `Factura emitida por $${res.totalAPagar}. Enlace de pago: ${res.paymentLinkUrl}`
          : 'Factura emitida; el equipo enviará el enlace en breve.',
      }
    }

    if (kind === 'cambios') {
      const res = await createExtraCambiosInvoiceForClient(ctx.clientId, quantity)
      if ('error' in res) return { error: res.error }
      return {
        ok: true,
        invoice_number: res.invoiceNumber,
        amount: res.totalAPagar,
        payment_link: res.paymentLinkUrl,
        message: res.paymentLinkUrl
          ? `Factura emitida por $${res.totalAPagar}. Enlace de pago: ${res.paymentLinkUrl}`
          : 'Factura emitida; el equipo enviará el enlace en breve.',
      }
    }

    return { error: 'kind inválido (content|cambios).' }
  },

  create_renewal_invoice: async (ctx) => {
    if (!ctx.clientId) return NO_CLIENT
    const res = await createRenewalInvoiceForClient(ctx.clientId)
    if ('needsHuman' in res) {
      return {
        needs_human: true,
        reason: res.reason,
        suggestion: 'Usa handoff_to_human para que el equipo gestione la renovación de este plan.',
      }
    }
    if ('error' in res) return { error: res.error }
    return {
      ok: true,
      invoice_number: res.invoiceNumber,
      amount: res.totalAPagar,
      payment_link: res.paymentLinkUrl,
      reused: res.reused,
      message: res.paymentLinkUrl
        ? `Factura de renovación${res.reused ? ' (ya existente)' : ''} por $${res.totalAPagar}. Enlace de pago: ${res.paymentLinkUrl}`
        : 'Factura de renovación emitida; el equipo enviará el enlace en breve.',
    }
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
    // needs_attention es la bandera semántica que alimenta la campana global y
    // el resaltado del inbox. bot_paused solo pausa (se usa también para la pausa
    // manual del staff), por eso NO alcanza para avisar de un handoff.
    await ctx.supabase
      .from('wa_conversations')
      .update({
        bot_paused: true,
        paused_at: new Date().toISOString(),
        unread_count: 1,
        needs_attention: true,
        attention_reason: reason || 'El bot escaló la conversación a un humano.',
        attention_at: new Date().toISOString(),
      })
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

  check_request_eligibility: async (ctx) => {
    if (!ctx.clientId) return NO_CLIENT
    return await checkRequestEligibilityForClient(ctx.clientId)
  },

  create_requirement_request: async (ctx, input) => {
    if (!ctx.clientId) return NO_CLIENT
    const contentType = String(input.content_type ?? '') as ContentType
    const title = String(input.title ?? '').trim()
    const desiredAt = String(input.desired_at ?? '').trim()
    const description = input.description ? String(input.description) : null
    const includesStory = input.includes_story === true

    if (!contentType) return { error: 'Falta content_type' }
    if (!title) return { error: 'Falta título' }
    if (!desiredAt) return { error: 'Falta fecha deseada' }

    // Pre-check disponibilidad para devolver mensaje útil antes de crear.
    const elig = await checkRequestEligibilityForClient(ctx.clientId)
    if (!elig.can_create) {
      return { error: 'No puedes crear solicitudes ahora.', blockers: elig.blockers }
    }
    const typeInfo = elig.available_content_types.find((t) => t.type === contentType)
    if (typeInfo && typeInfo.available <= 0) {
      return {
        error: elig.unified_pool
          ? `Ya no te quedan contenidos en tu paquete este ciclo (${elig.unified_pool.used}/${elig.unified_pool.limit} usados).`
          : `Ya no tienes disponibles para el tipo "${typeInfo.label}" en este ciclo.`,
        used: typeInfo.used,
        limit: typeInfo.limit,
        unified_pool: elig.unified_pool,
        suggestion: 'Sugerir al cliente esperar al próximo ciclo o escalar con handoff_to_human para revisar opciones de plan.',
      }
    }

    const res = await createRequirementFromBot({
      clientId: ctx.clientId,
      contentType,
      title,
      description,
      desiredAt,
      includesStory,
    })

    if ('error' in res) {
      return { error: res.error }
    }
    return {
      ok: true,
      requirement_id: res.id,
      message: `Solicitud creada. El equipo revisará tu petición de "${title}" y la aprobará pronto. Aparecerá en tu portal con estado "Pendiente de aprobación".`,
    }
  },

  get_changes_balance: async (ctx) => {
    if (!ctx.clientId) return NO_CLIENT
    const bal = await getCambiosBalance(ctx.clientId)
    if (!bal) return { error: 'No hay ciclo activo.' }
    return bal
  },

  request_requirement_change: async (ctx, input) => {
    if (!ctx.clientId) return NO_CLIENT
    const reqId = String(input.requirement_id ?? '').trim()
    const notes = String(input.change_notes ?? '').trim()
    if (!reqId) return { error: 'Falta requirement_id' }
    if (!notes) return { error: 'Falta la descripción del cambio' }

    const admin = createAdminClient()
    const { data } = await admin
      .from('requirements')
      .select('id, phase, billing_cycles!inner ( client_id )')
      .eq('id', reqId)
      .maybeSingle()
    if (!data) return { error: 'No encontrado' }
    const row = data as unknown as { id: string; phase: Phase; billing_cycles?: { client_id: string } }

    if (row.billing_cycles?.client_id !== ctx.clientId) {
      return { error: 'Ese requerimiento no pertenece a este cliente.' }
    }
    if (!canRequestChangeForPhase(row.phase)) {
      return { error: 'Ese contenido ya está aprobado/publicado y no admite cambios.' }
    }

    const bal = await getCambiosBalance(ctx.clientId)
    if (!bal || bal.total_available <= 0) {
      return {
        error: 'Se agotaron los cambios del plan para este mes.',
        suggestion: 'Ofrecer paquete de cambios extra o escalar con handoff_to_human.',
      }
    }

    const { data: log, error } = await admin
      .from('requirement_cambio_logs')
      .insert({ requirement_id: reqId, notes, created_by: FM_BOT_USER_ID, status: 'pending', voided: false })
      .select('id')
      .single()
    if (error || !log) return { error: 'No se pudo registrar el cambio' }

    await botPostMessage(admin, {
      requirementId: reqId,
      body: `✏️ Cambio solicitado por el cliente (vía WhatsApp): ${notes}`,
      visibleToClient: false,
    })

    return {
      ok: true,
      cambio_log_id: (log as { id: string }).id,
      message: 'Registré tu solicitud de cambio. El equipo la revisará y la aplicará pronto.',
    }
  },

  request_reschedule: async (ctx, input) => {
    if (!ctx.clientId) return NO_CLIENT
    const reqId = String(input.requirement_id ?? '').trim()
    const newDate = String(input.new_desired_date ?? '').trim()
    const reason = input.reason ? String(input.reason).trim() : null
    if (!reqId) return { error: 'Falta requirement_id' }
    if (!isPlausibleDesiredDate(newDate)) {
      return { error: 'Fecha inválida. Pide al cliente una fecha concreta (ej. 2026-07-15).' }
    }

    const admin = createAdminClient()
    const { data } = await admin
      .from('requirements')
      .select('id, assigned_to, billing_cycles!inner ( client_id )')
      .eq('id', reqId)
      .maybeSingle()
    if (!data) return { error: 'No encontrado' }
    const row = data as unknown as {
      id: string; assigned_to: string[] | null; billing_cycles?: { client_id: string }
    }
    if (row.billing_cycles?.client_id !== ctx.clientId) {
      return { error: 'Ese requerimiento no pertenece a este cliente.' }
    }

    const body = `📅 El cliente pide reprogramar a ${newDate}${reason ? ` — motivo: ${reason}` : ''}`
    const posted = await botPostMessage(admin, { requirementId: reqId, body, visibleToClient: false })
    if (!posted.ok) return { error: posted.error }

    let targets = (row.assigned_to ?? []).filter(Boolean)
    if (targets.length === 0) {
      const { data: staff } = await admin
        .from('users')
        .select('id')
        .in('role', ['admin', 'supervisor'])
      targets = (staff ?? []).map((u: { id: string }) => u.id)
    }
    if (targets.length > 0) {
      const rows = targets.map((uid) => ({
        message_id: posted.messageId,
        requirement_id: reqId,
        mentioned_user_id: uid,
        mentioned_by_user_id: FM_BOT_USER_ID,
      }))
      await admin.from('requirement_mentions').upsert(rows, { onConflict: 'message_id,mentioned_user_id' })
    }

    return { ok: true, message: 'Avisé al equipo tu nueva fecha deseada. Te confirmarán pronto.' }
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
