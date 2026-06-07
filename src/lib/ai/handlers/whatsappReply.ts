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

  const cfgRes = await ctx.supabase.from('wa_bot_configs').select('*').eq('id', 1).maybeSingle()
  const cfg: BotConfig = (cfgRes.data as BotConfig | null) ?? {
    system_prompt: 'Eres el asistente de WhatsApp de FM. Responde en español, breve y útil.',
    model: 'claude-sonnet-4-6',
    temperature: 0.3,
    max_tokens: 1024,
    enabled_tools: ['get_client_context', 'get_active_requirements', 'handoff_to_human'],
    history_window: DEFAULT_HISTORY,
  }
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

  await ctx.logEvent('progress', { step: 'sending_whatsapp', length: assistantText.length })

  const send = await sendWhatsappText({ toE164: conv.phone_e164, body: assistantText })
  const now = new Date().toISOString()

  const insert = await ctx.supabase
    .from('wa_messages')
    .insert({
      conversation_id: conversationId,
      direction: 'outbound',
      wamid: send.wamid,
      msg_type: 'text',
      body: assistantText,
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
    .update({ last_message_at: now, last_message_preview: assistantText.slice(0, 140) })
    .eq('id', conversationId)

  const freshInput = Math.max(0, totalInput - totalCached)
  const costCents = Math.ceil(
    (freshInput * 0.0003 + totalCached * 0.00003 + totalOutput * 0.0015) * 100,
  )
  await ctx.supabase.from('ai_jobs').update({ cost_usd_cents: costCents }).eq('id', ctx.job.id)

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
