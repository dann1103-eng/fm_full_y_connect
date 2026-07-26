# Recordatorio de factura por vencer — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enviar automáticamente por WhatsApp, a las 9:00 AM (El Salvador), un recordatorio con el PDF de la factura adjunto y un enlace de pago vigente, ~3 días antes de que la factura venza.

**Architecture:** Un cron de Vercel llama a una ruta Next.js que solo busca facturas y encola jobs (`invoice_due_reminder`) en `ai_jobs`. Un handler nuevo hace el trabajo pesado (regenerar enlace n1co → renderizar PDF → subirlo a Meta → enviar plantilla) y hereda el pipeline de jobs existente. La infra de documentos WhatsApp que se crea aquí la reutilizará después la tool `send_invoice_document` del bot.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (service role), `@react-pdf/renderer`, WhatsApp Cloud API (Graph v22), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-25-recordatorio-factura-por-vencer-design.md`

---

## Contexto imprescindible para quien implemente

Lee esto antes del Task 1; ahorra errores caros.

- **Las migraciones NO se aplican solas.** Se escriben en `supabase/migrations/` y el usuario las corre a mano en el Dashboard. Nunca asumas que una migración ya está aplicada.
- **`src/types/db.ts` es MANUAL**, no autogenerado. Si agregas una columna, edítalo tú.
- **Dos clientes Supabase distintos.** `createAdminClient()` (tipado, tablas del schema) y `createWaAdminClient()` (sin tipar, para tablas `wa_*` que no están en `Database`). Mezclarlos da errores de tipo.
- **El runner elige el cliente por prefijo del job_type**: `src/lib/ai/runner.ts:144` pasa el cliente `wa` solo si el tipo empieza con `whatsapp_`. Nuestro `invoice_due_reminder` recibirá el cliente **tipado** — para escribir en `wa_messages` hay que instanciar `createWaAdminClient()` dentro del handler.
- **Testing del repo:** hay Vitest con tests colocados (`src/**/*.test.ts`), pero solo sobre **funciones puras**. El repo evita mockear Supabase a propósito (ver comentario en `src/lib/supabase/active-client.ts:1-2`). Por eso este plan hace TDD real en la lógica pura (Task 5) y verificación manual/e2e en lo que toca red y DB.
- **Todo el texto de UI y mensajes va en español.** Commits en español con prefijo `feat:`/`fix:`/`docs:`.
- **No hagas `git push`** sin pedirlo explícitamente al usuario.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `supabase/migrations/0126_invoice_due_reminders.sql` | Marcador `due_reminder_sent_at`, `ai_jobs.invoice_id`, índices |
| `src/lib/billing/invoice-pdf.ts` | **Crear** — `renderInvoicePdfBuffer`: PDF sin gate de auth |
| `src/lib/whatsapp/media-upload.ts` | **Crear** — `uploadWhatsappMedia` (subir a Meta → `media_id`) |
| `src/lib/whatsapp/send.ts` | **Modificar** — agregar `sendWhatsappDocument` |
| `src/lib/whatsapp/templates.ts` | **Modificar** — header `document` + entry `INVOICE_DUE_SOON` |
| `src/lib/whatsapp/conversation.ts` | **Crear** — `resolveWaConversation` (buscar/crear conversación) |
| `src/lib/billing/due-reminders.ts` | **Crear** — lógica pura: ventana + throttle por teléfono |
| `src/lib/billing/due-reminders.test.ts` | **Crear** — tests de la lógica pura |
| `src/lib/ai/handlers/invoiceDueReminder.ts` | **Crear** — el handler |
| `src/lib/ai/runner.ts` | **Modificar** — registrar el handler |
| `src/app/api/billing/due-reminders/route.ts` | **Crear** — endpoint del cron |
| `vercel.json` | **Modificar** — segundo cron `0 15 * * *` |
| `src/types/db.ts` | **Modificar** — columnas nuevas |
| `supabase/functions/daily-cycle-runner/index.ts` | **Modificar** — fix del enlace expirado |

---

### Task 1: Fix del enlace n1co expirado (independiente, entrega valor solo)

Se hace primero porque es una línea, arregla un bug **ya activo en producción** y no depende de nada más.

**Files:**
- Modify: `supabase/functions/daily-cycle-runner/index.ts:285`

- [ ] **Step 1: Leer el contexto de la llamada**

Abre `supabase/functions/daily-cycle-runner/index.ts` alrededor de la línea 285. Verás
`expirationMinutes: 4320` dentro de la creación del enlace n1co. El resto del código deriva
la expiración de `due_date` (`src/lib/n1co/payment-links.ts:93-95`); este literal de 3 días
hace que el enlace muera ~5 días antes de que el cliente lo necesite.

- [ ] **Step 2: Sustituir el literal**

Cambia `expirationMinutes: 4320` por la expiración derivada del vencimiento. En ese archivo
la variable de la fecha de vencimiento es `scheduledPeriodStart` (la misma que se guarda como
`due_date` en la línea 462). Calcula los minutos hasta el fin de ese día:

```ts
// Minutos hasta las 23:59:59 del due_date (mismo criterio que src/lib/n1co/payment-links.ts).
// Antes: 4320 (3 días) hardcodeado → el enlace moría ~5 días antes de que el cliente pagara.
const endOfDueDate = new Date(`${scheduledPeriodStart}T23:59:59`)
const expirationMinutes = Math.max(60, Math.ceil((endOfDueDate.getTime() - Date.now()) / 60000))
```

y pasa `expirationMinutes` en lugar del literal.

- [ ] **Step 3: Verificar que el Edge Function sigue siendo válido**

Este archivo es Deno y **no se compila con el build de Next**. Revisa a ojo que
`scheduledPeriodStart` esté en alcance en ese punto (se define más arriba, en el bloque de
auto-billing). No introduzcas imports de `src/` — Deno no puede resolverlos.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations supabase/functions/daily-cycle-runner/index.ts
git commit -m "fix: enlace de pago n1co expiraba 5 dias antes del vencimiento"
```

> ⚠️ Este archivo se despliega como Edge Function de Supabase, **no** con Vercel. Avísale al
> usuario que debe redesplegarlo (`supabase functions deploy daily-cycle-runner`) o hacerlo
> desde el Dashboard.

---

### Task 2: Migración 0126 + tipos

**Files:**
- Create: `supabase/migrations/0126_invoice_due_reminders.sql`
- Modify: `src/types/db.ts`

- [ ] **Step 1: Escribir la migración**

```sql
-- 0126_invoice_due_reminders.sql
-- Soporte para el recordatorio automático "tu factura está por vencer".
--
-- 1) invoices.due_reminder_sent_at — marcador de NOTIFICACIÓN ENVIADA.
--    No confundir con billing_cycles.auto_billed_at, que marca FACTURA EMITIDA.
--    El handler lo escribe ANTES de enviar (at-most-once): si el proceso muere
--    tras enviar, el watchdog de 0124 reejecutaría el job y el cliente recibiría
--    un segundo cobro. Perder un recordatorio es preferible a duplicarlo.
-- 2) ai_jobs.invoice_id + índice único parcial — impide doble encolado.
-- 3) Índice de apoyo para el query diario del cron.

alter table public.invoices
  add column if not exists due_reminder_sent_at timestamptz;

alter table public.ai_jobs
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null;

-- Un solo recordatorio vivo por factura.
create unique index if not exists ai_jobs_one_active_due_reminder
  on public.ai_jobs(invoice_id)
  where status in ('pending','processing') and job_type = 'invoice_due_reminder';

-- Query del cron: facturas emitidas, sin recordar, por fecha de vencimiento.
create index if not exists invoices_due_reminder_pending_idx
  on public.invoices(due_date)
  where status = 'issued' and due_reminder_sent_at is null;
```

- [ ] **Step 2: Actualizar los tipos manuales**

En `src/types/db.ts`, en el `Row`/`Insert`/`Update` de `invoices` agrega
`due_reminder_sent_at: string | null` (opcional `?:` en Insert/Update), y en `ai_jobs`
agrega `invoice_id: string | null`. Busca `due_date` para ubicar el bloque de `invoices`.

También agrega `invoice_id: string | null` a `AiJobRow` en `src/lib/ai/types.ts`.

- [ ] **Step 3: Verificar tipos**

Run: `npm run build`
Expected: compila sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0126_invoice_due_reminders.sql src/types/db.ts src/lib/ai/types.ts
git commit -m "feat: migracion 0126 para recordatorios de factura por vencer"
```

---

### Task 3: Extraer el render del PDF sin auth

**Files:**
- Create: `src/lib/billing/invoice-pdf.ts`
- Modify: `src/app/api/invoices/[id]/pdf/route.tsx`

- [ ] **Step 1: Crear el módulo**

`InvoicePDF` solo necesita `{ invoice, items }` — no depende de sesión. Devolvemos también
la factura para que la ruta HTTP siga autorizando con `invoice.client_id` sin repetir queries.

```tsx
// src/lib/billing/invoice-pdf.ts
import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import { InvoicePDF } from '@/components/billing/InvoicePDF'

/**
 * Renderiza el PDF de una factura SIN gate de auth: el llamador valida el scope.
 * Lo usan la ruta HTTP (con sesión) y el recordatorio automático (service role).
 */
export async function renderInvoicePdfBuffer(supabase: SupabaseClient, invoiceId: string) {
  const { data: invoice } = await supabase
    .from('invoices').select('*').eq('id', invoiceId).maybeSingle()
  if (!invoice) return null

  const { data: items } = await supabase
    .from('invoice_items').select('*').eq('invoice_id', invoiceId).order('sort_order')

  const buffer = await renderToBuffer(
    <InvoicePDF invoice={invoice as never} items={(items ?? []) as never} />,
  )
  return { buffer, invoice, items: items ?? [] }
}
```

> El archivo lleva extensión `.tsx` implícita por el JSX — **nómbralo `invoice-pdf.tsx`**.

- [ ] **Step 2: Refactorizar la ruta para consumirlo**

En `src/app/api/invoices/[id]/pdf/route.tsx`, mantén intactos el chequeo de sesión y el de
permisos, pero reemplaza los queries de factura/items y el `renderToBuffer` por una llamada a
`renderInvoicePdfBuffer(supabase, id)`. Usa el `invoice` devuelto para la autorización
(`invoice.client_id`). Si devuelve `null`, responde 404 como antes.

- [ ] **Step 3: Verificar que el PDF sigue saliendo igual**

Run: `npm run dev`, entra como admin y abre `/api/invoices/<id-real>/pdf`.
Expected: el PDF descarga igual que antes; un usuario sin sesión sigue recibiendo 401.

- [ ] **Step 4: Commit**

```bash
git add src/lib/billing/invoice-pdf.tsx src/app/api/invoices/[id]/pdf/route.tsx
git commit -m "refactor: extrae render del PDF de factura para reuso sin sesion"
```

---

### Task 4: Infra de documentos WhatsApp

**Files:**
- Create: `src/lib/whatsapp/media-upload.ts`
- Modify: `src/lib/whatsapp/send.ts`, `src/lib/whatsapp/templates.ts`

- [ ] **Step 1: Subida de media a Meta**

```ts
// src/lib/whatsapp/media-upload.ts
import { GRAPH_API_BASE, getWhatsappEnv } from './env'

/**
 * Sube un binario a Meta y devuelve el media_id (válido ~30 días).
 * Sirve para adjuntar documentos tanto en mensajes libres como en plantillas.
 *
 * OJO: este media_id NO es el "header_handle" que pide la CREACIÓN de una
 * plantilla con encabezado de documento (ese sale de la Resumable Upload API,
 * /{app_id}/uploads). Son cosas distintas; la plantilla se aprueba a mano.
 */
export async function uploadWhatsappMedia(args: {
  buffer: Buffer
  filename: string
  mimeType: string
}): Promise<{ ok: boolean; mediaId: string | null; errorText?: string }> {
  const { token, phoneNumberId } = getWhatsappEnv()

  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', args.mimeType)
  form.append('file', new Blob([new Uint8Array(args.buffer)], { type: args.mimeType }), args.filename)

  // Sin Content-Type manual: fetch calcula el boundary del multipart.
  const res = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const raw = (await res.json().catch(() => ({}))) as { id?: string }
  if (!res.ok || !raw.id) return { ok: false, mediaId: null, errorText: JSON.stringify(raw) }
  return { ok: true, mediaId: raw.id }
}
```

- [ ] **Step 2: Envío de documento libre (para el bot, más adelante)**

En `src/lib/whatsapp/send.ts`, junto a `sendWhatsappText`, agrega `sendWhatsappDocument`
copiando su estructura (mismo endpoint, mismo manejo de `wamid`) pero con:

```ts
body: JSON.stringify({
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to,
  type: 'document',
  document: { id: args.mediaId, filename: args.filename, caption: args.caption },
})
```

- [ ] **Step 3: Header de documento en plantillas**

En `src/lib/whatsapp/templates.ts`, `sendWhatsappTemplate` acepta un argumento opcional
`headerDocument?: { mediaId: string; filename: string }`. Cuando venga, antepón el componente
de encabezado al de body:

```ts
const components: unknown[] = []
if (args.headerDocument) {
  components.push({
    type: 'header',
    parameters: [{
      type: 'document',
      document: { id: args.headerDocument.mediaId, filename: args.headerDocument.filename },
    }],
  })
}
if (orderedValues.length) {
  components.push({ type: 'body', parameters: orderedValues.map((v) => ({ type: 'text', text: v })) })
}
```

No cambies la firma existente de forma incompatible: `headerDocument` es opcional y
`REVIEW_READY` debe seguir funcionando exactamente igual.

- [ ] **Step 4: Declarar la plantilla**

En `WA_TEMPLATES` agrega:

```ts
  /**
   * Recordatorio de factura próxima a vencer (~3 días antes), con el PDF adjunto
   * como encabezado de documento.
   *
   * Body aprobado en Meta:
   *   "Hola {{1}} 👋 Te recordamos que tu factura {{2}} por {{3}} vence el {{4}}.
   *
   *    Puedes pagarla en este enlace: {{5}}
   *
   *    Si ya realizaste el pago, puedes ignorar este mensaje. ¡Gracias!"
   *
   * {{1}} es el nombre de la MARCA (clients.name), no el del contacto: es lo que
   * permite distinguir recordatorios de dos marcas que comparten el mismo número.
   */
  INVOICE_DUE_SOON: {
    name: 'factura_por_vencer',
    language: 'es_MX',
    category: 'UTILITY' as const,
    paramKeys: ['client_name', 'invoice_number', 'amount', 'due_date', 'payment_url'] as const,
  },
```

⚠️ `name` y `language` deben coincidir **carácter por carácter** con lo aprobado en Meta.
Confirma con el usuario antes de dar la tarea por cerrada.

- [ ] **Step 5: Verificar compilación**

Run: `npm run build && npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add src/lib/whatsapp/
git commit -m "feat: envio de documentos por WhatsApp y plantilla factura_por_vencer"
```

---

### Task 5: Lógica de selección (TDD — esta sí se testea)

Es la única parte con reglas de negocio no triviales: ventana de fechas y throttle por
teléfono. Al ser pura, se testea de verdad.

**Files:**
- Create: `src/lib/billing/due-reminders.ts`
- Test: `src/lib/billing/due-reminders.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/billing/due-reminders.test.ts
import { describe, it, expect } from 'vitest'
import { selectRemindersToSend, type ReminderCandidate } from './due-reminders'

const c = (o: Partial<ReminderCandidate>): ReminderCandidate => ({
  invoiceId: 'i1', clientId: 'c1', phoneE164: '+50370000000', dueDate: '2026-08-01', ...o,
})

describe('selectRemindersToSend', () => {
  it('envía una sola factura por teléfono: la de vencimiento más próximo', () => {
    const out = selectRemindersToSend([
      c({ invoiceId: 'tarde', dueDate: '2026-08-03' }),
      c({ invoiceId: 'pronto', dueDate: '2026-08-01' }),
    ])
    expect(out.map((r) => r.invoiceId)).toEqual(['pronto'])
  })

  it('no mezcla teléfonos distintos: cada número recibe el suyo', () => {
    const out = selectRemindersToSend([
      c({ invoiceId: 'a', phoneE164: '+50370000001' }),
      c({ invoiceId: 'b', phoneE164: '+50370000002' }),
    ])
    expect(out.map((r) => r.invoiceId).sort()).toEqual(['a', 'b'])
  })

  it('descarta candidatos sin teléfono', () => {
    expect(selectRemindersToSend([c({ phoneE164: null })])).toEqual([])
  })

  it('desempata de forma estable cuando dos facturas vencen el mismo día', () => {
    const out = selectRemindersToSend([
      c({ invoiceId: 'b', dueDate: '2026-08-01' }),
      c({ invoiceId: 'a', dueDate: '2026-08-01' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.invoiceId).toBe('a')
  })
})
```

- [ ] **Step 2: Ver el test fallar**

Run: `npm test -- src/lib/billing/due-reminders.test.ts`
Expected: FAIL — no existe el módulo `./due-reminders`.

- [ ] **Step 3: Implementación mínima**

```ts
// src/lib/billing/due-reminders.ts

export interface ReminderCandidate {
  invoiceId: string
  clientId: string
  phoneE164: string | null
  dueDate: string
}

/**
 * Un recordatorio por número por corrida, el de vencimiento más próximo.
 * Sin esto, un cliente con renovación + extra —o un número vinculado a varias
 * marcas (migración 0122)— recibiría varios mensajes la misma mañana.
 * Los descartados quedan sin marcar y salen en corridas siguientes.
 */
export function selectRemindersToSend(candidates: ReminderCandidate[]): ReminderCandidate[] {
  const byPhone = new Map<string, ReminderCandidate>()
  const ordered = [...candidates].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.invoiceId.localeCompare(b.invoiceId),
  )
  for (const cand of ordered) {
    if (!cand.phoneE164) continue
    if (!byPhone.has(cand.phoneE164)) byPhone.set(cand.phoneE164, cand)
  }
  return Array.from(byPhone.values())
}
```

- [ ] **Step 4: Ver el test pasar**

Run: `npm test -- src/lib/billing/due-reminders.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/billing/due-reminders.ts src/lib/billing/due-reminders.test.ts
git commit -m "feat: seleccion de recordatorios con throttle por telefono"
```

---

### Task 6: Handler `invoice_due_reminder`

**Files:**
- Create: `src/lib/whatsapp/conversation.ts`, `src/lib/ai/handlers/invoiceDueReminder.ts`
- Modify: `src/lib/ai/runner.ts`

- [ ] **Step 1: Helper de conversación**

Extrae en `src/lib/whatsapp/conversation.ts` la lógica de
`src/lib/ai/handlers/whatsappTemplate.ts:38-57`: `resolveWaConversation(waAdmin, phoneE164, clientId)`
busca por `phone_e164` y crea si no existe, devolviendo el id. **No modifiques
`whatsappTemplate.ts`** — está en producción; el refactor para que también lo use queda como
limpieza opcional posterior.

- [ ] **Step 2: Escribir el handler**

Orden de operaciones crítico — el marcador va **antes** del envío:

```ts
// src/lib/ai/handlers/invoiceDueReminder.ts
import { createWaAdminClient } from '@/lib/whatsapp/db'
import { renderInvoicePdfBuffer } from '@/lib/billing/invoice-pdf'
import { uploadWhatsappMedia } from '@/lib/whatsapp/media-upload'
import { sendWhatsappTemplate } from '@/lib/whatsapp/templates'
import { resolveWaConversation } from '@/lib/whatsapp/conversation'
import { regenerateInvoiceLinkCore } from '@/lib/domain/invoice-create'
import { formatDateEs } from '@/lib/domain/dates'
import type { AiHandler } from '@/lib/ai/types'

export const invoiceDueReminderHandler: AiHandler<{
  invoiceId?: string; phoneE164?: string; clientId?: string
}, { sent: boolean; skipped?: string }> = async (ctx, input) => {
  const invoiceId = input.invoiceId ?? (ctx.job.input_json as { invoiceId?: string }).invoiceId
  if (!invoiceId) throw new Error('invoice_due_reminder: invoiceId requerido')

  // 1. Estado actual: pudo pagarse entre el encolado y ahora.
  const { data: inv } = await ctx.supabase
    .from('invoices')
    .select('id, invoice_number, client_id, total_a_pagar, total, due_date, status, payment_date, due_reminder_sent_at')
    .eq('id', invoiceId).maybeSingle()
  if (!inv) throw new Error(`invoice_due_reminder: factura ${invoiceId} no existe`)
  if (inv.status !== 'issued' || inv.payment_date) {
    await ctx.logEvent('skipped', { reason: 'invoice_not_payable', status: inv.status })
    return { sent: false, skipped: 'invoice_not_payable' }
  }
  if (inv.due_reminder_sent_at) {
    await ctx.logEvent('skipped', { reason: 'already_reminded' })
    return { sent: false, skipped: 'already_reminded' }
  }

  // 2. Enlace vigente (el guardado suele estar expirado — ver spec).
  const link = await regenerateInvoiceLinkCore(ctx.supabase as never, invoiceId)
  const paymentUrl = link?.url ?? null
  if (!paymentUrl) throw new Error('invoice_due_reminder: no se pudo generar el enlace de pago')

  // 3. PDF → Meta.
  const pdf = await renderInvoicePdfBuffer(ctx.supabase, invoiceId)
  if (!pdf) throw new Error('invoice_due_reminder: no se pudo renderizar el PDF')
  const filename = `Factura-${inv.invoice_number}.pdf`
  const media = await uploadWhatsappMedia({ buffer: pdf.buffer, filename, mimeType: 'application/pdf' })
  if (!media.ok || !media.mediaId) throw new Error(`invoice_due_reminder: upload a Meta falló: ${media.errorText}`)

  // 4. Datos del destinatario.
  const wa = createWaAdminClient()
  const { data: client } = await ctx.supabase
    .from('clients').select('name').eq('id', inv.client_id).maybeSingle()
  const { data: contact } = await wa
    .from('client_whatsapp_contacts').select('phone_e164')
    .eq('client_id', inv.client_id)
    .order('is_primary', { ascending: false }).order('created_at', { ascending: true })
    .limit(1).maybeSingle()
  const phoneE164 = input.phoneE164 ?? (contact as { phone_e164?: string } | null)?.phone_e164
  if (!phoneE164) return { sent: false, skipped: 'sin_contacto_whatsapp' }

  // 5. MARCAR ANTES DE ENVIAR (at-most-once). Ver spec: el watchdog de 0124
  //    reejecutaría el handler si el proceso muere tras enviar → cobro duplicado.
  await ctx.supabase
    .from('invoices')
    .update({ due_reminder_sent_at: new Date().toISOString() })
    .eq('id', invoiceId)

  const amount = `$${Number(inv.total_a_pagar ?? inv.total ?? 0).toFixed(2)}`
  const send = await sendWhatsappTemplate({
    toE164: phoneE164,
    templateKey: 'INVOICE_DUE_SOON',
    params: {
      client_name: client?.name ?? 'cliente',
      invoice_number: String(inv.invoice_number),
      amount,
      due_date: formatDateEs(inv.due_date!),
      payment_url: paymentUrl,
    },
    headerDocument: { mediaId: media.mediaId, filename },
  })

  // 6. Fallo explícito → limpiar el marcador para reintentar mañana.
  if (!send.ok) {
    await ctx.supabase.from('invoices').update({ due_reminder_sent_at: null }).eq('id', invoiceId)
    await ctx.logEvent('due_reminder_failed', { error: send.errorText })
    throw new Error(`invoice_due_reminder: envío falló: ${send.errorText}`)
  }

  // 7. Registrar el outbound en el inbox.
  const conversationId = await resolveWaConversation(wa, phoneE164, inv.client_id)
  const now = new Date().toISOString()
  await wa.from('wa_messages').insert({
    conversation_id: conversationId, direction: 'outbound', wamid: send.wamid,
    msg_type: 'document', sent_by: 'system', ai_job_id: ctx.job.id,
    body: `Recordatorio de pago — factura ${inv.invoice_number} (PDF adjunto)`,
    wa_status: 'sent', raw_json: send.raw, created_at: now,
  })
  await wa.from('wa_conversations')
    .update({ last_message_at: now, last_message_preview: '📄 Recordatorio de pago' })
    .eq('id', conversationId)

  return { sent: true }
}
```

Verifica la firma real de `regenerateInvoiceLinkCore` en `src/lib/domain/invoice-create.ts:169`
y ajusta cómo se lee la URL devuelta — no asumas el nombre del campo.

- [ ] **Step 3: Registrar en el runner**

En `src/lib/ai/runner.ts`, importa el handler y agrégalo a `HANDLERS`:
`invoice_due_reminder: invoiceDueReminderHandler as AiHandler,`

- [ ] **Step 4: Verificar**

Run: `npm run build && npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/handlers/invoiceDueReminder.ts src/lib/whatsapp/conversation.ts src/lib/ai/runner.ts
git commit -m "feat: handler invoice_due_reminder con PDF adjunto"
```

---

### Task 7: Cron y endpoint

**Files:**
- Create: `src/app/api/billing/due-reminders/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Escribir el endpoint**

Copia el patrón de auth de `src/app/api/ai-jobs/process/route.ts:20-32` (header de
`CRON_SECRET` o `AI_JOBS_TRIGGER_SECRET`) pero **NO copies el fallback por query param de las
líneas 33-34** — está marcado en el propio código como deuda a eliminar.

```ts
export const runtime = 'nodejs'
export const maxDuration = 60
```

Lógica: `today()` y `addDaysString()` de `@/lib/domain/dates` para la ventana
(`today+1` … `today+3`); query de `invoices` con
`status='issued'`, `payment_date is null`, `due_reminder_sent_at is null`,
`due_date` entre esos límites; resolver teléfono por cliente
(`client_whatsapp_contacts`, `is_primary desc, created_at asc, limit 1`);
pasar todo por `selectRemindersToSend`; e insertar los jobs.

**Inserta fila por fila**, no en lote: el índice único parcial lanza `23505` y en un insert
por lote un solo conflicto abortaría todo. Traga ese código y sigue:

```ts
for (const r of toSend) {
  const { error } = await admin.from('ai_jobs').insert({
    job_type: 'invoice_due_reminder',
    status: 'pending',
    priority: 7, // por debajo de whatsapp_reply (5): el bot en vivo tiene preferencia
    client_id: r.clientId,
    invoice_id: r.invoiceId,
    input_json: { invoiceId: r.invoiceId, phoneE164: r.phoneE164, clientId: r.clientId },
    scheduled_for: new Date().toISOString(),
  } as never)
  if (error && error.code !== '23505') console.error('[due-reminders] insert', error.message)
}
```

Devuelve `{ candidates, enqueued }` para poder diagnosticar desde los logs.

- [ ] **Step 2: Agregar el cron**

En `vercel.json`, junto al cron existente:

```json
{ "path": "/api/billing/due-reminders", "schedule": "0 15 * * *" }
```

15:00 UTC = 9:00 AM El Salvador (GMT-6, sin horario de verano).

- [ ] **Step 3: Probar en local sin enviar nada**

Con `npm run dev`, invoca el endpoint con el secret correcto. Si aún no hay facturas en
ventana, debe responder `{ candidates: 0, enqueued: 0 }` sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/billing/due-reminders/route.ts vercel.json
git commit -m "feat: cron diario de recordatorios de factura por vencer"
```

---

### Task 8: Verificación end-to-end

No marques la feature como terminada sin esto.

- [ ] **Step 1: Pedirle al usuario que aplique la migración 0126** en el Dashboard de Supabase
      y que confirme que la plantilla `factura_por_vencer` está **aprobada** en Meta.

- [ ] **Step 2: Prueba del pipeline sin depender de Meta.** Con una factura de prueba
      (`due_date = hoy+3`), invoca el cron. Verifica en `ai_jobs` que se creó el job con
      `priority=7` e `invoice_id`. Si la plantilla no está aprobada, el job debe fallar con
      error 132000 y `due_reminder_sent_at` debe quedar **en NULL** (se limpia solo).

- [ ] **Step 3: Prueba real.** Con la plantilla aprobada, repite. Confirma:
      llega el mensaje con el PDF adjunto; el enlace abre el checkout de n1co y **no** está
      expirado; la fecha del texto coincide con el `due_date` real (no el día anterior).

- [ ] **Step 4: Idempotencia.** Invoca el cron dos veces seguidas → un solo mensaje;
      la segunda no encola nada.

- [ ] **Step 5: Throttle.** Cliente con dos facturas en ventana → un solo mensaje ese día.

- [ ] **Step 6: Regresión del Task 1.** Una factura recién emitida por el cron nocturno debe
      traer expiración de enlace hasta su `due_date`, no 3 días.

- [ ] **Step 7: Documentar.** Agrega las filas 0125/0126 a la tabla de migraciones de
      `CLAUDE.md` y una nota en la sección de WhatsApp sobre el recordatorio automático.
      Commit `docs:`.

---

## Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| El nombre/idioma de la plantilla no coincide con Meta | Confirmar con el usuario tras la aprobación (Task 4 Step 4) |
| Un recordatorio que falla es invisible para el equipo | Deuda anotada en el spec: no hay panel de jobs fallidos |
| El staff no puede abrir el PDF desde el inbox (`media_path` NULL) | Limitación aceptada; el `body` lleva etiqueta legible |
| Lote grande de recordatorios satura el runner | `priority=7` cede el paso al bot; el cron de cada minuto drena la cola |
