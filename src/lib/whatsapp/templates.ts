import { GRAPH_API_BASE, getWhatsappEnv } from './env'

/**
 * Plantillas WhatsApp aprobadas por Meta — fuente de verdad del CÓDIGO de la app.
 * Cada entry define los parámetros que el template espera.
 *
 * El BODY real (texto) se aprueba en Meta; aquí solo declaramos la metadata
 * para que la app sepa cómo armar el payload del envío.
 *
 * Para crear/aprobar templates: usar `submitTemplateForApproval()` o el UI de
 * https://business.facebook.com/wa/manage/message-templates/?waba_id=<WABA_ID>
 */
export const WA_TEMPLATES = {
  /**
   * Notifica al cliente cuando uno de sus requerimientos entra a fase
   * `revision_cliente` y está listo para que lo revise/apruebe en el portal.
   *
   * Body sugerido:
   *   "Hola {{1}} 👋  Tu contenido «{{2}}» ya está listo para tu revisión.
   *    Puedes verlo y aprobarlo desde tu portal: {{3}}"
   *
   * Variables:
   *  - {{1}} nombre del cliente o del contacto
   *  - {{2}} título del requerimiento (o tipo si no tiene título)
   *  - {{3}} URL al portal
   */
  REVIEW_READY: {
    name: 'revision_cliente_lista',
    // El template fue aprobado por Meta con código 'es_MX' (Meta lo asigna por
    // defecto al elegir "Spanish" desde el UI). Si en el futuro lo recreas en
    // otro código, actualiza aquí — debe coincidir EXACTO con el aprobado.
    language: 'es_MX',
    category: 'UTILITY' as const,
    paramKeys: ['client_name', 'requirement_title', 'portal_url'] as const,
  },

  /**
   * Recordatorio de factura próxima a vencer (~3 días antes), con el PDF de la
   * factura adjunto como ENCABEZADO DE DOCUMENTO.
   *
   * Body aprobado por Meta (2026-07-26):
   *   "Hola {{1}} 👋 Te recordamos que tu factura {{2}} por {{3}} vence el {{4}}.
   *
   *    Puedes pagarla en este enlace: {{5}}
   *
   *    Si ya realizaste el pago, puedes ignorar este mensaje. ¡Gracias!"
   *
   * La línea de cierre no es decorativa: Meta rechaza plantillas que empiecen o
   * terminen con una variable, y sin ella el cuerpo acabaría en {{5}}.
   *
   * Variables:
   *  - {{1}} nombre de la MARCA (clients.name), no el del contacto: es lo que
   *          distingue recordatorios de dos marcas que comparten el mismo número
   *  - {{2}} número de factura
   *  - {{3}} monto a pagar (con símbolo)
   *  - {{4}} fecha de vencimiento ya formateada
   *  - {{5}} enlace de pago n1co (regenerado antes de enviar)
   */
  INVOICE_DUE_SOON: {
    name: 'factura_por_vencer',
    language: 'es_MX',
    category: 'UTILITY' as const,
    paramKeys: ['client_name', 'invoice_number', 'amount', 'due_date', 'payment_url'] as const,
  },
} as const

export type WaTemplateKey = keyof typeof WA_TEMPLATES

export interface SendTemplateResult {
  ok: boolean
  wamid: string | null
  raw: Record<string, unknown>
  errorText?: string
}

/**
 * Envía un mensaje basado en una plantilla aprobada (válido fuera de la
 * ventana de 24h del cliente). Si la plantilla aún no está aprobada, Meta
 * responde con error y devolvemos {ok:false}.
 */
export async function sendWhatsappTemplate(args: {
  toE164: string
  templateKey: WaTemplateKey
  params: Record<string, string>
  /**
   * Adjunta un documento en el encabezado. Solo para plantillas aprobadas con
   * header de tipo DOCUMENT (p. ej. INVOICE_DUE_SOON). El `mediaId` sale de
   * `uploadWhatsappMedia`.
   */
  headerDocument?: { mediaId: string; filename: string }
}): Promise<SendTemplateResult> {
  const tpl = WA_TEMPLATES[args.templateKey]
  const { token, phoneNumberId } = getWhatsappEnv()

  const orderedValues = tpl.paramKeys.map((k) => args.params[k] ?? '')
  const components: unknown[] = []
  // El encabezado va ANTES del body en el payload de Meta.
  if (args.headerDocument) {
    components.push({
      type: 'header',
      parameters: [{
        type: 'document',
        document: {
          id: args.headerDocument.mediaId,
          filename: args.headerDocument.filename,
        },
      }],
    })
  }
  if (orderedValues.length) {
    components.push({
      type: 'body',
      parameters: orderedValues.map((v) => ({ type: 'text', text: v })),
    })
  }

  const to = args.toE164.replace(/^\+/, '')
  const res = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: tpl.name, language: { code: tpl.language }, components },
    }),
  })

  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) return { ok: false, wamid: null, raw, errorText: JSON.stringify(raw) }
  const messages = raw['messages']
  const wamid =
    Array.isArray(messages) && messages[0] && typeof messages[0] === 'object'
      ? ((messages[0] as { id?: string }).id ?? null)
      : null
  return { ok: true, wamid, raw }
}

/**
 * Crea (o re-envía) una plantilla a Meta para aprobación. Se ejecuta una sola
 * vez por plantilla (idempotencia manual). Devuelve el id que Meta le asigna.
 *
 * Después de llamar esto, Meta tarda entre 1 minuto y 24h en aprobar/rechazar.
 * Mientras está en pending, los envíos fallan con error 132000.
 */
export async function submitTemplateForApproval(args: {
  key: WaTemplateKey
  bodyText: string  // con marcadores {{1}}, {{2}}, etc.
  example?: string[]  // valores de ejemplo para cada parámetro
}): Promise<{ ok: boolean; id?: string; raw: Record<string, unknown>; errorText?: string }> {
  const tpl = WA_TEMPLATES[args.key]
  const { token, wabaId } = getWhatsappEnv()
  if (!wabaId) return { ok: false, raw: {}, errorText: 'WHATSAPP_WABA_ID no configurado' }

  const components: unknown[] = [
    {
      type: 'BODY',
      text: args.bodyText,
      ...(args.example?.length
        ? { example: { body_text: [args.example] } }
        : {}),
    },
  ]

  const res = await fetch(`${GRAPH_API_BASE}/${wabaId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: tpl.name,
      language: tpl.language,
      category: tpl.category,
      components,
    }),
  })

  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) return { ok: false, raw, errorText: JSON.stringify(raw) }
  const id = (raw['id'] as string | undefined) ?? undefined
  return { ok: true, id, raw }
}
