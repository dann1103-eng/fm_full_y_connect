import type Anthropic from '@anthropic-ai/sdk'
import type { Client, ClientBrandProfile, ContentMatrix, ContentMatrixItem, ContentType, MatrixTopic } from '@/types/db'
import { BRAND_PERSON_LABELS } from '@/lib/domain/brand'
import { MATRIX_OBJECTIVES, MATRIX_OBJECTIVE_LABELS, MATRIX_ESTIMATE_MAX_MINUTES, MATRIX_TEXT_LIMITS } from '@/lib/domain/matrix'
import type { PlanCapacity } from '@/lib/domain/matrix-ai'
import { CONTENT_TYPE_LABELS } from '@/lib/domain/plans'
import { formatDeadlineDate } from '@/lib/domain/deadline'

/**
 * Prompts y esquemas de salida de la generación de matrices (bloque 3).
 *
 * Viven en código y no en base: no hay una `wa_bot_configs` para matrices y no vale la pena inventarle
 * una tabla de configuración a dos prompts.
 *
 * **La forma de la llamada también vive aquí** (`forceTool`, `readToolInput`) para que el padre y el hijo
 * no diverjan. Verificada contra el SDK instalado (`@anthropic-ai/sdk@0.95.2`,
 * `resources/messages/messages.d.ts`): `ToolChoiceTool = { type: 'tool'; name: string;
 * disable_parallel_tool_use?: boolean }`.
 */

// ── Bloque de sistema compartido ────────────────────────────────────────────

export interface BrandSystemInput {
  client: Pick<Client, 'name' | 'giro'>
  profile: ClientBrandProfile
  matrix: Pick<ContentMatrix, 'title' | 'topics_json' | 'notes'>
  period: { periodStart: string; periodEnd: string; label: string }
}

function bullet(label: string, value: string | null | undefined): string {
  const v = value?.trim()
  return v ? `- ${label}: ${v}` : ''
}

/**
 * El contexto de marca con el que la IA escribe. Es el bloque que se manda con
 * `cache_control: { type: 'ephemeral' }` — **sin prometer ahorro**: la caché efímera vive unos minutos y
 * tiene un mínimo de bloque que un perfil corto puede no alcanzar; si pega, bien.
 */
export function buildBrandSystemBlock(input: BrandSystemInput): string {
  const { client, profile, matrix, period } = input
  const person = profile.person ? BRAND_PERSON_LABELS[profile.person] : null

  const lines: string[] = [
    'Sos el estratega de contenido de FM Communication Solutions, una agencia salvadoreña de marketing digital.',
    'Escribís contenido para redes sociales de una marca cliente. Todo tu texto va en español de El Salvador.',
    '',
    `## La marca: ${client.name}`,
    // `.filter(Boolean)` solo sobre los bullets: aplicado a toda la lista se comería las líneas en blanco.
    ...[
      bullet('Giro', client.giro),
      bullet('Tono de voz', profile.tone),
      bullet('Público', profile.audience),
      bullet('Propuesta de valor', profile.value_proposition),
      bullet('Qué ofrece (podés nombrarlo)', profile.offerings),
      bullet('Qué NO decir (prohibido)', profile.avoid),
    ].filter(Boolean),
  ]

  if (person) {
    lines.push(
      '',
      `## Persona gramatical: ${person}`,
      `OBLIGATORIO: usá ${person} en TODO el texto que escribas —copy, guion, llamado a la acción, todo—,`,
      'en cada verbo y cada pronombre, sin mezclar con las otras formas. Es lo primero que nota el cliente.',
    )
  }

  const hashtags = (profile.base_hashtags ?? []).filter((h) => typeof h === 'string' && h.trim())
  if (hashtags.length > 0) {
    lines.push('', '## Hashtags base', `Incluilos siempre, además de los específicos de la pieza: ${hashtags.join(' ')}`)
  }

  const samples = (profile.sample_copies ?? []).filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
  if (samples.length > 0) {
    lines.push('', '## Copys reales que funcionaron (imitá su voz, no su contenido)')
    samples.forEach((c, i) => lines.push(`${i + 1}. ${c.trim()}`))
  }

  lines.push(
    '',
    `## La matriz: ${matrix.title}`,
    `- Período: ${period.label}`,
  )
  const notes = matrix.notes?.trim()
  if (notes) lines.push(`- Notas del equipo: ${notes}`)
  const topics = matrix.topics_json ?? []
  if (topics.length > 0) {
    lines.push('- Temas del mes ya definidos por el equipo:')
    topics.forEach((t, i) => lines.push(`  ${i}. ${t.name}${t.note ? ` — ${t.note}` : ''}`))
  }

  lines.push(
    '',
    '## Reglas que no se rompen',
    '- Nada de promesas de resultados, precios ni datos que no estén arriba. Si no lo sabés, no lo inventés.',
    '- Nada de emojis en cascada ni de lenguaje de plantilla ("¡Descubrí el poder de…!", "En el mundo actual…").',
    '- Sin markdown: el texto se copia tal cual a las redes.',
  )

  return lines.join('\n')
}

// ── Esquemas de salida ──────────────────────────────────────────────────────

export const MATRIX_PLAN_TOOL_NAME = 'submit_matrix_plan'
export const MATRIX_BRIEF_TOOL_NAME = 'submit_piece_brief'

const OBJECTIVE_HELP = MATRIX_OBJECTIVES.join(' | ')

/**
 * Tool del padre. El `content_type` va restringido por enum a los tipos que realmente caben: el modelo no
 * puede proponer un tipo que el plan del cliente no tiene vivo. El tema es un **índice** a la lista final
 * de temas, nunca texto libre — así no hay temas inventados que descartar después.
 */
export function matrixPlanTool(opts: { allowedTypes: ContentType[]; askForTopics: boolean }): Anthropic.Tool {
  const properties: Record<string, unknown> = {
    pieces: {
      type: 'array',
      description: 'Las piezas del mes, en el orden en que deberían publicarse.',
      items: {
        type: 'object',
        properties: {
          content_type: {
            type: 'string',
            enum: opts.allowedTypes,
            description: 'Tipo de pieza. Solo estos valores.',
          },
          title: {
            type: 'string',
            description: `Título interno de la pieza, concreto y distinto al de las demás. Máximo ${MATRIX_TEXT_LIMITS.title} caracteres.`,
          },
          topic_index: {
            type: 'integer',
            description: 'Índice (base 0) del tema del mes al que pertenece la pieza. Omitilo si ninguno aplica.',
          },
          objective: {
            type: 'string',
            enum: MATRIX_OBJECTIVES,
            description: `Para qué es la pieza: ${OBJECTIVE_HELP}.`,
          },
          needs_production: {
            type: 'boolean',
            description: 'true si la pieza necesita una producción audiovisual aparte (rodaje, sesión de fotos).',
          },
          estimated_time_minutes: {
            type: 'integer',
            description: `Minutos de trabajo estimados para producir la pieza (entre 1 y ${MATRIX_ESTIMATE_MAX_MINUTES}).`,
          },
        },
        required: ['content_type', 'title', 'objective', 'needs_production', 'estimated_time_minutes'],
      },
    },
  }

  if (opts.askForTopics) {
    properties.topics = {
      type: 'array',
      description: 'De 3 a 5 temas del mes. El `topic_index` de cada pieza apunta a esta lista.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nombre corto del tema (máximo 60 caracteres).' },
          note: { type: 'string', description: 'Una línea que explique el ángulo del tema (opcional).' },
        },
        required: ['name'],
      },
    }
  }

  return {
    name: MATRIX_PLAN_TOOL_NAME,
    description: 'Entrega el plan de la matriz del mes: los temas (si se piden) y la lista de piezas.',
    input_schema: { type: 'object', properties, required: ['pieces'] },
  }
}

// ── Largo de trabajo del brief ──────────────────────────────────────────────

interface CharRange { min: number; max: number }

/**
 * Rango de trabajo de cada campo del brief, en caracteres. **Son los números que ve el modelo**, no los
 * topes de `MATRIX_TEXT_LIMITS`: esos topes suman ~21 000 caracteres y el hijo tiene
 * `MATRIX_CHILD_PARAMS.max_tokens` = 1500, unos 4 500–5 000 caracteres de español dentro del JSON de la
 * tool. Un modelo que apunta al tope se corta a mitad (`stop_reason: 'max_tokens'`) y el brief se pierde.
 *
 * Presupuesto: el peor caso —una pieza de video con cada campo en su máximo— son 2 870 caracteres, ~960
 * tokens a 3 caracteres por token más el JSON: unos dos tercios de `max_tokens`, con margen para que el
 * modelo se pase de los rangos sin cortarse. `prompts.test.ts` fija esa cuenta: si se sube un rango, hay
 * que mirar `max_tokens` en `model.ts`.
 */
export const BRIEF_WORKING_RANGES = {
  copy: { min: 200, max: 600 },
  /** Guion de una pieza de video (`video_corto`, `reel`, `short`): escena por escena. */
  scriptVideo: { min: 600, max: 1500 },
  /** Guion de un estático o una historia. */
  scriptShort: { min: 150, max: 500 },
  visual_style: { min: 150, max: 400 },
  hashtags: { min: 40, max: 250 },
  cta: { min: 20, max: 120 },
} as const satisfies Record<string, CharRange>

const VIDEO_SCRIPT_TYPES: readonly ContentType[] = ['video_corto', 'reel', 'short']

/** El rango del guion depende del tipo: un reel se cuenta por escenas, un estático no. */
export function scriptRange(type: ContentType): CharRange {
  return VIDEO_SCRIPT_TYPES.includes(type) ? BRIEF_WORKING_RANGES.scriptVideo : BRIEF_WORKING_RANGES.scriptShort
}

function span(r: CharRange): string {
  return `${r.min}–${r.max}`
}

/**
 * Tool del hijo: el brief de UNA pieza. No incluye ningún campo que el bloque 2 congela al convertir.
 *
 * **Idéntica para todas las piezas** (no depende del tipo): va delante del bloque de sistema en el
 * prefijo de caché, así que variarla por pieza invalidaría la caché del bloque de marca. Por eso el
 * guion da los dos rangos y el prompt de usuario, que va después, dice cuál aplica.
 */
export function matrixBriefTool(): Anthropic.Tool {
  const R = BRIEF_WORKING_RANGES
  return {
    name: MATRIX_BRIEF_TOOL_NAME,
    description: 'Entrega el brief redactado de la pieza.',
    input_schema: {
      type: 'object',
      properties: {
        copy: {
          type: 'string',
          description: `Texto que se publica con la pieza. Entre ${R.copy.min} y ${R.copy.max} caracteres; tope duro ${MATRIX_TEXT_LIMITS.copy}.`,
        },
        script: {
          type: 'string',
          description: `Guion, escena por escena, para las piezas con video. Para un estático, describí el orden de lectura del arte. Largo: ${span(R.scriptVideo)} caracteres en un video corto, reel o short; ${span(R.scriptShort)} en un estático o una historia. Tope duro ${MATRIX_TEXT_LIMITS.script}.`,
        },
        visual_style: {
          type: 'string',
          description: `Indicaciones visuales para diseño: encuadre, colores, tipografía, referencias. Entre ${R.visual_style.min} y ${R.visual_style.max} caracteres; tope duro ${MATRIX_TEXT_LIMITS.visual_style}.`,
        },
        hashtags: {
          type: 'string',
          description: `Hashtags separados por espacio, con # incluido. Entre ${R.hashtags.min} y ${R.hashtags.max} caracteres en total; tope duro ${MATRIX_TEXT_LIMITS.hashtags}.`,
        },
        cta: {
          type: 'string',
          description: `Llamado a la acción, una frase. Entre ${R.cta.min} y ${R.cta.max} caracteres; tope duro ${MATRIX_TEXT_LIMITS.cta}.`,
        },
        objective: {
          type: 'string',
          enum: MATRIX_OBJECTIVES,
          description: `Para qué es la pieza: ${OBJECTIVE_HELP}. Solo cambialo si el que trae está claramente equivocado.`,
        },
        needs_production: {
          type: 'boolean',
          description: 'true si la pieza necesita una producción audiovisual aparte.',
        },
      },
      required: ['copy', 'visual_style', 'hashtags', 'cta'],
    },
  }
}

// ── Mensajes del usuario ────────────────────────────────────────────────────

export interface PlanPromptInput {
  /** De `missingByType`: cuántas piezas caben por tipo y, bajo pool, en total. */
  capacity: PlanCapacity
  /** Tipos que la generación puede usar (bajo pool NO incluye `historia`). */
  allowedTypes: ContentType[]
  /** Temas que la matriz ya tiene. Si está vacío, se le piden al modelo. */
  topics: MatrixTopic[]
  /** Títulos de las piezas que la matriz ya tiene: no hay que repetirlas. */
  existingTitles: string[]
}

export function buildPlanPrompt(input: PlanPromptInput): string {
  const { capacity, allowedTypes, topics, existingTitles } = input
  const lines: string[] = ['Armá el plan de contenido de esta matriz.', '']

  if (topics.length === 0) {
    lines.push(
      'La matriz todavía no tiene temas: proponé entre 3 y 5 temas del mes, coherentes entre sí y con la marca,',
      'y repartí las piezas entre ellos con `topic_index`.',
      '',
    )
  } else {
    lines.push(
      'La matriz ya tiene sus temas (están en el contexto de arriba, numerados desde 0): NO propongas otros.',
      'Repartí las piezas entre esos temas con `topic_index`.',
      '',
    )
  }

  if (capacity.poolRemaining !== null) {
    const reparto = allowedTypes.map((t) => CONTENT_TYPE_LABELS[t]).join(', ')
    lines.push(
      `## Cuántas piezas: exactamente ${capacity.poolRemaining} en total`,
      `El plan del cliente usa un pool compartido: vos decidís el reparto entre ${reparto}, pero el TOTAL no puede pasar de ${capacity.poolRemaining}.`,
      'No propongas historias: este plan no las contempla.',
    )
  } else {
    lines.push(`## Cuántas piezas: exactamente ${capacity.total} en total, repartidas así`)
    for (const t of allowedTypes) {
      const n = capacity.missing[t] ?? 0
      if (n > 0) lines.push(`- ${CONTENT_TYPE_LABELS[t]} (\`${t}\`): ${n}`)
    }
    lines.push('No propongas ni más ni menos de esas cantidades: lo que sobre se descarta.')
  }

  if (existingTitles.length > 0) {
    lines.push(
      '',
      '## Piezas que la matriz YA tiene (no las repitas ni las rehagas)',
      ...existingTitles.map((t) => `- ${t}`),
    )
  }

  lines.push(
    '',
    '## Cómo quiero el plan',
    '- Cada pieza con un ángulo propio: nada de la misma idea dicha de cinco formas.',
    '- El título es para el equipo, no para publicar: que diga de qué va la pieza.',
    '- Alterná objetivos (no todo venta) y respetá el tono y lo que la marca no puede decir.',
    '- El estimado es el tiempo real de producción de esa pieza para un equipo de agencia.',
    '',
    `Devolvé el plan llamando a la herramienta \`${MATRIX_PLAN_TOOL_NAME}\`. No escribas nada fuera de la herramienta.`,
  )

  return lines.join('\n')
}

export interface BriefPromptInput {
  item: Pick<ContentMatrixItem, 'content_type' | 'title' | 'topic' | 'objective' | 'deadline' | 'needs_production' | 'copy' | 'script' | 'visual_style' | 'hashtags' | 'cta'>
  /** Instrucciones del usuario al regenerar (ya recortadas a 300 en el servidor). Mandan sobre todo lo demás. */
  instructions?: string | null
}

export function buildBriefPrompt(input: BriefPromptInput): string {
  const { item } = input
  const instructions = input.instructions?.trim()
  const lines: string[] = []

  if (instructions) {
    lines.push(
      '## Instrucciones del equipo (mandan sobre todo lo demás)',
      instructions,
      '',
    )
  }

  lines.push(
    'Redactá el brief completo de esta pieza.',
    '',
    '## La pieza',
    `- Tipo: ${CONTENT_TYPE_LABELS[item.content_type]}`,
    `- Título: ${item.title}`,
  )
  if (item.topic) lines.push(`- Tema del mes: ${item.topic}`)
  if (item.objective) lines.push(`- Objetivo: ${MATRIX_OBJECTIVE_LABELS[item.objective]}`)
  lines.push(`- Fecha de entrega: ${formatDeadlineDate(item.deadline)}`)
  if (item.needs_production) lines.push('- Necesita producción audiovisual aparte.')

  const previous = [
    item.copy?.trim() ? `Copy: ${item.copy.trim()}` : '',
    item.script?.trim() ? `Guion: ${item.script.trim()}` : '',
    item.visual_style?.trim() ? `Estilo visual: ${item.visual_style.trim()}` : '',
    item.hashtags?.trim() ? `Hashtags: ${item.hashtags.trim()}` : '',
    item.cta?.trim() ? `CTA: ${item.cta.trim()}` : '',
  ].filter(Boolean)
  if (previous.length > 0) {
    lines.push('', '## Versión actual (la vas a reemplazar entera)', ...previous)
  }

  // Rangos de trabajo, no los topes duros como meta: ver `BRIEF_WORKING_RANGES`.
  const R = BRIEF_WORKING_RANGES
  lines.push(
    '',
    '## Largo de cada campo',
    'Apuntá a estos rangos. El brief entero tiene que caber en una sola respuesta: si se corta, se pierde completo.',
    `- copy: ${span(R.copy)} caracteres (el tope duro es ${MATRIX_TEXT_LIMITS.copy})`,
    `- script: ${span(scriptRange(item.content_type))} caracteres (el tope duro es ${MATRIX_TEXT_LIMITS.script})`,
    `- visual_style: ${span(R.visual_style)} caracteres (el tope duro es ${MATRIX_TEXT_LIMITS.visual_style})`,
    `- hashtags: ${span(R.hashtags)} caracteres en total (el tope duro es ${MATRIX_TEXT_LIMITS.hashtags})`,
    `- cta: una frase de ${span(R.cta)} caracteres (el tope duro es ${MATRIX_TEXT_LIMITS.cta})`,
    '',
    `Devolvé el brief llamando a la herramienta \`${MATRIX_BRIEF_TOOL_NAME}\`. No escribas nada fuera de la herramienta.`,
  )

  return lines.join('\n')
}

// ── La forma de la llamada ──────────────────────────────────────────────────

/**
 * `tool_choice` que obliga al modelo a llamar a esa tool y solo a esa. Forma verificada contra el SDK
 * instalado; `disable_parallel_tool_use` garantiza un único bloque `tool_use` en la respuesta.
 */
export function forceTool(name: string): Anthropic.ToolChoiceTool {
  return { type: 'tool', name, disable_parallel_tool_use: true }
}

/**
 * Saca el input del bloque `tool_use` de la respuesta. **Recorre `content`, no lee `content[0]`**: un
 * bloque de texto (o de pensamiento) delante desplaza al `tool_use` y el índice fijo devolvería basura.
 * Devuelve `null` si el modelo no llamó a la tool — el handler lo traduce a "sin plan válido".
 */
export function readToolInput(content: readonly unknown[], name: string): unknown {
  for (const block of content) {
    const b = block as { type?: unknown; name?: unknown; input?: unknown } | null
    if (!b || b.type !== 'tool_use' || b.name !== name) continue
    return b.input ?? null
  }
  return null
}
