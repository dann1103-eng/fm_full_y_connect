import Anthropic from '@anthropic-ai/sdk'
import { sendWhatsappText } from '@/lib/whatsapp/send'
import { filterEnabled, TOOL_FNS, type ToolContext } from '@/lib/ai/tools'
import type { AiHandler } from '@/lib/ai/types'

const MAX_TOOL_ROUNDS = 6
const DEFAULT_HISTORY = 20

interface BotConfig {
  system_prompt: string
  model: string
  temperature: number
  max_tokens: number
  enabled_tools: string[]
  history_window: number
}

interface ConvRow {
  id: string
  phone_e164: string
  client_id: string | null
  bot_paused: boolean
  display_name: string | null
}

interface MsgRow {
  id: string
  direction: 'inbound' | 'outbound'
  body: string | null
  msg_type: string
  media_path: string | null
  sent_by: 'bot' | 'staff' | 'system' | null
  created_at: string
  processed_at: string | null
}

interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string | Array<unknown>
}

export const whatsappReplyHandler: AiHandler<{ conversationId?: string }, {
  messageId: string | null
  costCents: number
  toolCalls: number
  skipped?: string
}> = async (ctx, input) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('whatsapp_reply: falta ANTHROPIC_API_KEY')

  const conversationId =
    input.conversationId ?? (ctx.job.input_json as { conversationId?: string }).conversationId
  if (!conversationId) throw new Error('whatsapp_reply: conversationId requerido')

  await ctx.logEvent('progress', { step: 'load_context', conversationId })

  const convRes = await ctx.supabase
    .from('wa_conversations')
    .select('id, phone_e164, client_id, bot_paused, display_name')
    .eq('id', conversationId)
    .maybeSingle()
  if (convRes.error || !convRes.data) throw new Error(`whatsapp_reply: conv no encontrada: ${convRes.error?.message}`)
  const conv = convRes.data as ConvRow

  if (conv.bot_paused) {
    await ctx.logEvent('skipped', { reason: 'bot_paused' })
    return { messageId: null, costCents: 0, toolCalls: 0, skipped: 'bot_paused' }
  }

  // Selecciona la config según si la conversación está vinculada a un cliente
  // (audience='client') o no (audience='lead' — prospectos / leads).
  const audience: 'client' | 'lead' = conv.client_id ? 'client' : 'lead'
  const cfgRes = await ctx.supabase
    .from('wa_bot_configs')
    .select('*')
    .eq('audience', audience)
    .maybeSingle()
  const cfg: BotConfig = (cfgRes.data as BotConfig | null) ?? {
    system_prompt: 'Eres el asistente de WhatsApp de FM. Responde en español, breve y útil.',
    model: 'claude-sonnet-4-6',
    temperature: 0.3,
    max_tokens: 600,
    enabled_tools: audience === 'lead' ? ['handoff_to_human'] : ['get_client_context', 'handoff_to_human'],
    history_window: DEFAULT_HISTORY,
  }
  await ctx.logEvent('progress', { step: 'config_loaded', audience })
  const model = process.env.ANTHROPIC_MODEL || cfg.model || 'claude-sonnet-4-6'

  const historyRes = await ctx.supabase
    .from('wa_messages')
    .select('id, direction, body, msg_type, media_path, sent_by, created_at, processed_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(cfg.history_window || DEFAULT_HISTORY)
  const historyDesc = (historyRes.data ?? []) as MsgRow[]
  const history = historyDesc.slice().reverse()

  const newInbound = history.filter((m) => m.direction === 'inbound' && m.processed_at === null)
  if (newInbound.length === 0) {
    await ctx.logEvent('skipped', { reason: 'no_new_messages' })
    return { messageId: null, costCents: 0, toolCalls: 0, skipped: 'no_new_messages' }
  }

  // Primera vez que el bot responde en esta conversación? Si no hay outbound
  // previo enviado por el bot, prependemos un saludo identificándose.
  const isFirstReply = !history.some((m) => m.direction === 'outbound' && m.sent_by === 'bot')

  const messages = buildClaudeMessages(history)

  const tools = filterEnabled(cfg.enabled_tools)
  const toolCtx: ToolContext = {
    supabase: ctx.supabase,
    conversationId,
    clientId: conv.client_id,
    phoneE164: conv.phone_e164,
  }

  const anthropic = new Anthropic({ apiKey })
  let totalInput = 0
  let totalOutput = 0
  let totalCached = 0
  let toolCalls = 0
  let assistantText = ''

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    await ctx.logEvent('progress', { step: 'claude_call', round })

    const response = await anthropic.messages.create({
      model,
      max_tokens: cfg.max_tokens,
      temperature: cfg.temperature,
      system: [{ type: 'text', text: cfg.system_prompt, cache_control: { type: 'ephemeral' } }],
      tools: (tools.length ? tools : undefined) as never,
      messages: messages as never,
    })

    totalInput += response.usage.input_tokens
    totalOutput += response.usage.output_tokens
    totalCached += response.usage.cache_read_input_tokens ?? 0

    if (response.stop_reason === 'tool_use') {
      const assistantBlocks = response.content
      messages.push({ role: 'assistant', content: assistantBlocks as never })

      const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = []
      for (const block of assistantBlocks) {
        if (block.type !== 'tool_use') continue
        toolCalls++
        const fn = TOOL_FNS[block.name]
        let resultPayload: unknown
        try {
          resultPayload = fn
            ? await fn(toolCtx, (block.input as Record<string, unknown>) ?? {})
            : { error: `tool_not_implemented: ${block.name}` }
        } catch (e) {
          resultPayload = { error: e instanceof Error ? e.message : String(e) }
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(resultPayload).slice(0, 6000),
        })
      }
      messages.push({ role: 'user', content: toolResults as never })
      continue
    }

    const textBlock = response.content.find((c: { type: string }) => c.type === 'text')
    assistantText = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : ''
    break
  }

  if (!assistantText) throw new Error('whatsapp_reply: el modelo no produjo texto tras el loop de tools')

  // En el primer turno, prependemos el saludo institucional (identificación
  // explícita del bot — buena práctica de transparencia y reduce riesgo de
  // reportes de spam por parte del cliente). El saludo varía según audiencia
  // para que clientes existentes no escuchen "te ayudo con cotizaciones" y
  // leads no escuchen "te ayudo con tu facturación".
  const WELCOME_CLIENT =
    'Hola, soy el asistente automatizado de FM. Estoy aquí para ayudarte con consultas sobre tus contenidos, facturación y publicaciones. Si en cualquier momento prefieres hablar con una persona, solo dilo.'
  const WELCOME_LEAD =
    'Hola, soy el asistente automatizado de FM Communication Solutions. Si necesitas información sobre nuestros servicios o una cotización, estoy aquí para ayudarte. Si prefieres hablar con un asesor humano, solo dilo.'
  const WELCOME = audience === 'client' ? WELCOME_CLIENT : WELCOME_LEAD

  // Filtro defensivo: si Claude saludó a pesar del system prompt, quitamos
  // su saludo para que no haya doble bienvenida.
  const cleanedAssistant = isFirstReply ? stripLeadingGreeting(assistantText) : assistantText
  const finalText = isFirstReply ? `${WELCOME}\n\n${cleanedAssistant}` : cleanedAssistant

  await ctx.logEvent('progress', { step: 'sending_whatsapp', length: finalText.length, firstReply: isFirstReply })

  const send = await sendWhatsappText({ toE164: conv.phone_e164, body: finalText })
  const now = new Date().toISOString()

  const insert = await ctx.supabase
    .from('wa_messages')
    .insert({
      conversation_id: conversationId,
      direction: 'outbound',
      wamid: send.wamid,
      msg_type: 'text',
      body: finalText,
      sent_by: 'bot',
      ai_job_id: ctx.job.id,
      wa_status: send.ok ? 'sent' : 'failed',
      wa_error_json: send.ok ? null : send.raw,
      raw_json: send.raw,
      created_at: now,
    })
    .select('id')
    .single()

  const ids = newInbound.map((m) => m.id)
  if (ids.length) {
    await ctx.supabase.from('wa_messages').update({ processed_at: now }).in('id', ids)
  }

  await ctx.supabase
    .from('wa_conversations')
    .update({ last_message_at: now, last_message_preview: finalText.slice(0, 140) })
    .eq('id', conversationId)

  const freshInput = Math.max(0, totalInput - totalCached)
  const costCents = Math.ceil(
    (freshInput * 0.0003 + totalCached * 0.00003 + totalOutput * 0.0015) * 100,
  )
  await ctx.supabase
    .from('ai_jobs')
    .update({
      cost_usd_cents: costCents,
      tokens_input: totalInput,
      tokens_output: totalOutput,
      tokens_cached: totalCached,
    })
    .eq('id', ctx.job.id)

  if (!send.ok) await ctx.logEvent('whatsapp_send_failed', { error: send.errorText })

  return { messageId: insert.data?.id ?? null, costCents, toolCalls }
}

function buildClaudeMessages(history: MsgRow[]): ClaudeMessage[] {
  const msgs: ClaudeMessage[] = []
  for (const m of history) {
    const role: 'user' | 'assistant' = m.direction === 'inbound' ? 'user' : 'assistant'
    const text = renderMsgForModel(m)
    if (!text) continue
    const last = msgs[msgs.length - 1]
    if (last && last.role === role && typeof last.content === 'string') {
      last.content = `${last.content}\n${text}`
    } else {
      msgs.push({ role, content: text })
    }
  }
  while (msgs.length && msgs[0]!.role !== 'user') msgs.shift()
  return msgs
}

/**
 * Quita el primer "párrafo" si parece un saludo institucional. Defensa contra
 * Claude que a veces ignora la regla del system prompt de no saludar en
 * el primer turno (porque el sistema ya antepone el welcome).
 */
function stripLeadingGreeting(text: string): string {
  const blocks = text.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 0)
  if (blocks.length === 0) return text
  // Patrones típicos de saludo/auto-identificación que Claude a veces antepone
  // a pesar del system prompt: "Hola", "¡Hola!", "Buen día/tardes/noches",
  // "Hello", "Bienvenido", "Saludos", "Soy el asistente...".
  const greetingRe = /^(¡?\s*(hola|hello|hi|buen[ao]s?\s+(d[ií]as|tardes|noches)|saludos|bienvenido|bienvenida|estimado|estimada|que\s+tal)|soy\s+(el\s+)?asistente)/i
  let i = 0
  while (i < Math.min(3, blocks.length) && greetingRe.test(blocks[i]!)) i++
  if (i === 0) return text
  const remainder = blocks.slice(i).join('\n\n').trim()
  return remainder || text
}

function renderMsgForModel(m: MsgRow): string {
  const tag = m.sent_by === 'staff' ? '[STAFF respondió manualmente] ' : ''
  if (m.msg_type === 'text') return tag + (m.body ?? '')
  if (m.msg_type === 'image') return `${tag}[imagen]${m.body ? ' — ' + m.body : ''}`
  if (m.msg_type === 'audio') return `${tag}[audio sin transcribir]`
  if (m.msg_type === 'video') return `${tag}[video]${m.body ? ' — ' + m.body : ''}`
  if (m.msg_type === 'document') return `${tag}[documento]${m.body ? ' — ' + m.body : ''}`
  if (m.msg_type === 'location') return `${tag}${m.body ?? '[ubicación]'}`
  if (m.msg_type === 'sticker') return `${tag}[sticker]`
  if (m.msg_type === 'interactive') return `${tag}${m.body ?? '[respuesta interactiva]'}`
  return tag + (m.body ?? '')
}
